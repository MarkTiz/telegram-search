import type { CoreDB } from '@tg-search/core'

import { EventEmitter } from 'node:events'

import { CoreEventType } from '@tg-search/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { mockDB } from '../../../../packages/core/src/db/mock'
import { accountModels } from '../../../../packages/core/src/models/accounts'
import { accountsTable } from '../../../../packages/core/src/schemas/accounts'
import { telegramAuthSessionsTable } from '../../../../packages/core/src/schemas/telegram-auth-sessions'
import { accountStates } from '../account'
import { decryptSession, encryptSession } from './cipher'
import {
  configureAuthSessionStore,
  ensureAuthSessionWatch,
  listPublicAuthSessions,
  planSessionRestores,
  resetAuthSessionStoreForTests,
} from './service'

const SECRET = 'c'.repeat(32)
const SESSION = '1AgAOM-test-session-value'

const dbHolder: { db?: CoreDB } = {}

vi.mock('../storage/drizzle', () => ({
  getDB: () => {
    if (!dbHolder.db)
      throw new Error('Test database is not ready')
    return dbHolder.db
  },
}))

function fakeAccount(id: string) {
  const emitter = new EventEmitter()
  const account = {
    ctx: {
      emitter,
      getClient: () => {
        throw new Error('no client')
      },
      cleanup: () => {},
    },
    accountReady: false,
    activePeers: new Set<string>(),
    coreEventListeners: new Map(),
    createdAt: 0,
    lastActive: 0,
  }
  accountStates.set(id, account as never)
  return { emitter, account }
}

async function waitFor(predicate: () => Promise<boolean>) {
  const started = Date.now()
  while (Date.now() - started < 2000) {
    if (await predicate())
      return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Timed out waiting for Telegram auth session write')
}

describe('auth session persistence', () => {
  beforeEach(async () => {
    resetAuthSessionStoreForTests()
    accountStates.clear()
    configureAuthSessionStore(SECRET)
    dbHolder.db = await mockDB({
      accountsTable,
      telegramAuthSessionsTable,
    })
  })

  afterEach(() => {
    accountStates.clear()
    resetAuthSessionStoreForTests()
  })

  it('stores ciphertext instead of the GramJS session string', async () => {
    const { emitter, account } = fakeAccount('slot-1')
    ensureAuthSessionWatch(account as never, 'slot-1')
    emitter.emit(CoreEventType.SessionUpdate, { session: SESSION })

    await waitFor(async () => {
      const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
      return rows.length === 1
    })

    const [row] = await dbHolder.db!.select().from(telegramAuthSessionsTable)
    expect(row?.session_ciphertext).not.toContain(SESSION)
    expect(decryptSession(row!.session_ciphertext, SECRET)).toBe(SESSION)

    const catalog = await listPublicAuthSessions()
    expect(catalog).toEqual([
      { id: 'slot-1', displayName: null, telegramUserId: null, connected: false },
    ])
    expect(JSON.stringify(catalog)).not.toContain(SESSION)
    expect(JSON.stringify(catalog)).not.toContain(row?.session_ciphertext)
  })

  it('keeps a single runtime when a second slot logs in as the same Telegram account', async () => {
    const dbAccount = await accountModels.recordAccount(dbHolder.db!, 'telegram', 'user-1')
    const first = fakeAccount('slot-1')
    const second = fakeAccount('slot-2')
    ensureAuthSessionWatch(first.account as never, 'slot-1')
    ensureAuthSessionWatch(second.account as never, 'slot-2')

    first.emitter.emit(CoreEventType.SessionUpdate, { session: SESSION })
    first.emitter.emit(CoreEventType.AccountReady, { accountId: dbAccount.id })
    await waitFor(async () => {
      const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
      return rows.some(row => row.id === 'slot-1' && row.account_id === dbAccount.id)
    })

    second.emitter.emit(CoreEventType.SessionUpdate, { session: `${SESSION}-next` })
    second.emitter.emit(CoreEventType.EntityMeData, { id: '42', name: 'Ada', type: 'user', username: 'ada' })
    second.emitter.emit(CoreEventType.AccountReady, { accountId: dbAccount.id })
    await waitFor(async () => {
      const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
      return rows.length === 1
        && rows[0]?.id === 'slot-2'
        && rows[0]?.display_name === 'Ada'
        && !accountStates.has('slot-1')
    })

    expect(accountStates.has('slot-1')).toBe(false)
    expect(accountStates.has('slot-2')).toBe(true)
    const [kept] = await dbHolder.db!.select().from(telegramAuthSessionsTable)
    expect(kept?.session_ciphertext).not.toContain(SESSION)
    expect(decryptSession(kept!.session_ciphertext, SECRET)).toBe(`${SESSION}-next`)
  })

  it('deletes a revoked session so the next startup does not reconnect it', async () => {
    const { emitter, account } = fakeAccount('slot-1')
    ensureAuthSessionWatch(account as never, 'slot-1')
    emitter.emit(CoreEventType.SessionUpdate, { session: SESSION })
    await waitFor(async () => {
      const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
      return rows.length === 1
    })

    emitter.emit(CoreEventType.AuthDisconnected)
    await waitFor(async () => {
      const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
      return rows.length === 0
    })

    const rows = await dbHolder.db!.select().from(telegramAuthSessionsTable)
    expect(rows).toEqual([])
  })

  it('plans startup reconnects from ciphertext and skips unreadable rows', () => {
    const calls: string[] = []
    const logger = {
      withError: () => logger,
      withFields: () => logger,
      error: (message: string) => {
        calls.push(message)
      },
      log: () => {},
      warn: () => {},
    }
    const planned = planSessionRestores([
      { id: 'ok', session_ciphertext: encryptSession(SESSION, SECRET) },
      { id: 'bad', session_ciphertext: 'not-a-payload' },
    ], SECRET, logger as never)

    expect(planned).toEqual([{ id: 'ok', session: SESSION }])
    expect(calls.join(' ')).not.toContain(SESSION)
  })
})
