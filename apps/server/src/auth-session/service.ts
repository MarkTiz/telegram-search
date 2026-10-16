import type { Logger } from '@guiiai/logg'
import type { Config } from '@tg-search/common'
import type { CoreDB } from '@tg-search/core'

import type { AccountState } from '../account'

import { useLogger } from '@guiiai/logg'
import { CoreEventType, destroyCoreInstance, models } from '@tg-search/core'

import { accountStates, getOrCreateAccount, peerObjects } from '../account'
import { getDB } from '../storage/drizzle'
import { decryptSession, encryptSession } from './cipher'

export interface PublicAuthSession {
  id: string
  displayName: string | null
  telegramUserId: string | null
  connected: boolean
}

interface WriteQueue {
  tail: Promise<void>
}

const writeQueues = new Map<string, WriteQueue>()
const watchedAccounts = new WeakSet<AccountState>()
const linkedAccounts = new Map<string, string>()

let sessionSecret: string | undefined

export function configureAuthSessionStore(secret: string | undefined): void {
  sessionSecret = secret
}

export function isAuthSessionStoreEnabled(): boolean {
  return sessionSecret !== undefined
}

export function resetAuthSessionStoreForTests(): void {
  sessionSecret = undefined
  writeQueues.clear()
  linkedAccounts.clear()
}

function enqueueWrite(sessionId: string, task: () => Promise<void>, logger: Logger): void {
  const current = writeQueues.get(sessionId)?.tail ?? Promise.resolve()
  const tail = current.then(task).catch((error: unknown) => {
    logger.withError(error).withFields({ sessionId }).error('Failed to update stored Telegram auth session')
  })
  writeQueues.set(sessionId, { tail })
}

export function ensureAuthSessionWatch(account: AccountState, sessionId: string): void {
  const secret = sessionSecret
  if (!secret || watchedAccounts.has(account))
    return

  watchedAccounts.add(account)
  const logger = useLogger('server:auth-session')
  const db = (): CoreDB => getDB()

  account.ctx.emitter.on(CoreEventType.SessionUpdate, ({ session }) => {
    if (!session)
      return
    // Persist ciphertext only. Callers must not log `session`.
    enqueueWrite(sessionId, async () => {
      const ciphertext = encryptSession(session, secret)
      ;(await models.telegramAuthSessionModels.upsertCiphertext(db(), sessionId, ciphertext)).expect('Failed to store Telegram auth session')
    }, logger)
  })

  account.ctx.emitter.on(CoreEventType.EntityMeData, (me) => {
    enqueueWrite(sessionId, async () => {
      ;(await models.telegramAuthSessionModels.updateProfile(db(), sessionId, {
        telegramUserId: me.id,
        displayName: me.name,
      })).expect('Failed to store Telegram profile')
    }, logger)
  })

  account.ctx.emitter.on(CoreEventType.AccountReady, ({ accountId }) => {
    linkedAccounts.set(sessionId, accountId)
    enqueueWrite(sessionId, async () => {
      ;(await models.telegramAuthSessionModels.linkAccount(db(), sessionId, accountId)).expect('Failed to link Telegram auth session')
      await retireOtherRuntimes(accountId, sessionId, logger)
    }, logger)
  })

  const forget = () => {
    linkedAccounts.delete(sessionId)
    enqueueWrite(sessionId, async () => {
      ;(await models.telegramAuthSessionModels.deleteSession(db(), sessionId)).expect('Failed to delete Telegram auth session')
    }, logger)
  }

  account.ctx.emitter.on(CoreEventType.AuthDisconnected, forget)
  account.ctx.emitter.on(CoreEventType.AuthLogout, forget)
}

async function retireOtherRuntimes(accountId: string, keepSessionId: string, logger: Logger): Promise<void> {
  const doomed = [...linkedAccounts.entries()]
    .filter(([id, linked]) => id !== keepSessionId && linked === accountId)
    .map(([id]) => id)

  for (const id of doomed) {
    logger.withFields({ sessionId: id, accountId }).log('Retiring duplicate Telegram runtime')
    linkedAccounts.delete(id)
    ;(await models.telegramAuthSessionModels.deleteSession(getDB(), id)).expect('Failed to delete duplicate Telegram auth session')
    const state = accountStates.get(id)
    if (!state)
      continue
    state.accountReady = false
    for (const peerId of state.activePeers)
      peerObjects.get(peerId)?.close()
    await destroyCoreInstance(state.ctx)
    accountStates.delete(id)
  }
}

export async function listPublicAuthSessions(): Promise<PublicAuthSession[]> {
  const rows = (await models.telegramAuthSessionModels.listPublicSessions(getDB())).expect('Failed to list Telegram auth sessions')
  return rows.map(row => ({
    id: row.id,
    displayName: row.display_name,
    telegramUserId: row.telegram_user_id,
    connected: accountStates.get(row.id)?.accountReady === true,
  }))
}

export async function importAuthSessions(
  config: Config,
  sessions: { id: string, session: string }[],
): Promise<PublicAuthSession[]> {
  const secret = sessionSecret
  if (!secret)
    throw new Error('Telegram auth session store is disabled')

  for (const item of sessions) {
    const ciphertext = encryptSession(item.session, secret)
    ;(await models.telegramAuthSessionModels.upsertCiphertext(getDB(), item.id, ciphertext)).expect('Failed to import Telegram auth session')
    const account = getOrCreateAccount(item.id, config)
    ensureAuthSessionWatch(account, item.id)
    if (!account.accountReady)
      account.ctx.emitter.emit(CoreEventType.AuthLogin, { session: item.session })
  }

  return listPublicAuthSessions()
}

export interface PlannedSessionRestore {
  id: string
  session: string
}

export function planSessionRestores(
  rows: { id: string, session_ciphertext: string }[],
  secret: string,
  logger: Logger,
): PlannedSessionRestore[] {
  const planned: PlannedSessionRestore[] = []
  for (const row of rows) {
    try {
      planned.push({ id: row.id, session: decryptSession(row.session_ciphertext, secret) })
    }
    catch (error) {
      logger.withError(error).withFields({ sessionId: row.id }).error('Skipping unreadable Telegram auth session')
    }
  }
  return planned
}

export async function restorePersistedAuthSessions(config: Config): Promise<void> {
  const secret = sessionSecret
  const logger = useLogger('server:auth-session')
  if (!secret) {
    logger.warn('TG_SEARCH_SESSION_SECRET is unset; Telegram auth sessions stay in the browser')
    return
  }

  const rows = (await models.telegramAuthSessionModels.listStoredSessions(getDB())).expect('Failed to load Telegram auth sessions')
  const planned = planSessionRestores(rows, secret, logger)
  logger.withFields({ count: planned.length }).log('Restoring Telegram auth sessions')

  for (const item of planned) {
    const account = getOrCreateAccount(item.id, config)
    ensureAuthSessionWatch(account, item.id)
    if (account.accountReady)
      continue
    account.ctx.emitter.emit(CoreEventType.AuthLogin, { session: item.session })
  }
}
