import type { CoreDB } from '../db'
import type { PromiseResult } from '../utils/result'

import { and, asc, eq, ne } from 'drizzle-orm'

import { telegramAuthSessionsTable } from '../schemas/telegram-auth-sessions'
import { withResult } from '../utils/result'

export interface PublicTelegramAuthSession {
  id: string
  display_name: string | null
  telegram_user_id: string | null
}

export interface StoredTelegramAuthSession extends PublicTelegramAuthSession {
  session_ciphertext: string
  account_id: string | null
}

async function upsertCiphertext(db: CoreDB, id: string, ciphertext: string): PromiseResult<void> {
  return withResult(async () => {
    const now = Date.now()
    await db
      .insert(telegramAuthSessionsTable)
      .values({
        id,
        session_ciphertext: ciphertext,
        created_at: now,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: telegramAuthSessionsTable.id,
        set: {
          session_ciphertext: ciphertext,
          updated_at: now,
        },
      })
  })
}

async function updateProfile(
  db: CoreDB,
  id: string,
  profile: { telegramUserId: string, displayName: string },
): PromiseResult<void> {
  return withResult(async () => {
    await db
      .update(telegramAuthSessionsTable)
      .set({
        telegram_user_id: profile.telegramUserId,
        display_name: profile.displayName,
        updated_at: Date.now(),
      })
      .where(eq(telegramAuthSessionsTable.id, id))
  })
}

/**
 * Keep a single stored session for a Telegram account row.
 * Another WebSocket slot that already claimed this account releases it.
 */
async function linkAccount(db: CoreDB, id: string, accountId: string): PromiseResult<void> {
  return withResult(async () => {
    const now = Date.now()
    await db
      .update(telegramAuthSessionsTable)
      .set({
        account_id: null,
        updated_at: now,
      })
      .where(and(
        eq(telegramAuthSessionsTable.account_id, accountId),
        ne(telegramAuthSessionsTable.id, id),
      ))

    const rows = await db
      .update(telegramAuthSessionsTable)
      .set({
        account_id: accountId,
        updated_at: now,
      })
      .where(eq(telegramAuthSessionsTable.id, id))
      .returning()

    if (rows.length === 0)
      throw new Error('Telegram auth session was not stored before it was linked')
  })
}

async function deleteSession(db: CoreDB, id: string): PromiseResult<void> {
  return withResult(async () => {
    await db
      .delete(telegramAuthSessionsTable)
      .where(eq(telegramAuthSessionsTable.id, id))
  })
}

async function listPublicSessions(db: CoreDB): PromiseResult<PublicTelegramAuthSession[]> {
  return withResult(async () => {
    return db
      .select({
        id: telegramAuthSessionsTable.id,
        display_name: telegramAuthSessionsTable.display_name,
        telegram_user_id: telegramAuthSessionsTable.telegram_user_id,
      })
      .from(telegramAuthSessionsTable)
      .orderBy(asc(telegramAuthSessionsTable.created_at))
  })
}

async function listStoredSessions(db: CoreDB): PromiseResult<StoredTelegramAuthSession[]> {
  return withResult(async () => {
    return db
      .select({
        id: telegramAuthSessionsTable.id,
        display_name: telegramAuthSessionsTable.display_name,
        telegram_user_id: telegramAuthSessionsTable.telegram_user_id,
        session_ciphertext: telegramAuthSessionsTable.session_ciphertext,
        account_id: telegramAuthSessionsTable.account_id,
      })
      .from(telegramAuthSessionsTable)
      .orderBy(asc(telegramAuthSessionsTable.created_at))
  })
}

export const telegramAuthSessionModels = {
  upsertCiphertext,
  updateProfile,
  linkAccount,
  deleteSession,
  listPublicSessions,
  listStoredSessions,
}

export type TelegramAuthSessionModels = typeof telegramAuthSessionModels
