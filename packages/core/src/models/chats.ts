// https://github.com/moeru-ai/airi/blob/main/services/telegram-bot/src/models/chats.ts

import type { CoreDB } from '../db'
import type { JoinedChatType } from '../schemas/joined-chats'
import type { CoreDialog } from '../types/dialog'
import type { CoreEntity } from '../types/events'
import type { PromiseResult } from '../utils/result'
import type { DBSelectChat, DBSelectChatWithAccount } from './utils/types'

import { and, desc, eq, gt, inArray, sql } from 'drizzle-orm'

import { accountJoinedChatsTable } from '../schemas/account-joined-chats'
import { chatMessagesTable } from '../schemas/chat-messages'
import { joinedChatsTable } from '../schemas/joined-chats'
import { withResult } from '../utils/result'
import { parseDate } from './utils/time'

/**
 * Record chats for a specific account
 */
async function recordChats(db: CoreDB, chats: CoreDialog[], accountId: string): Promise<DBSelectChat[]> {
  // Use a single transaction so joined_chats and account_joined_chats are consistent
  return db.transaction(async (tx) => {
    // Insert or update joined_chats
    const joinedChats = await tx
      .insert(joinedChatsTable)
      .values(chats.map(chat => ({
        platform: 'telegram',
        chat_id: chat.id.toString(),
        chat_name: chat.name,
        chat_type: chat.type,
        chat_username: chat.username || null,
        last_message_from_name: chat.lastMessageFromName || null,
        last_message: chat.lastMessage || null,
        dialog_date: parseDate(chat.lastMessageDate),
      })))
      .onConflictDoUpdate({
        target: joinedChatsTable.chat_id,
        set: {
          chat_name: sql`excluded.chat_name`,
          chat_type: sql`excluded.chat_type`,
          chat_username: sql`COALESCE(excluded.chat_username, ${joinedChatsTable.chat_username})`,
          last_message_from_name: sql`excluded.last_message_from_name`,
          last_message: sql`excluded.last_message`,
          dialog_date: sql`excluded.dialog_date`,
          updated_at: Date.now(),
        },
      })
      .returning()

    // If accountId is provided, automatically link to account_joined_chats
    if (accountId && joinedChats.length > 0) {
      // Check if ANY of the input dialogs contain folder information.
      // If none do (typical for basic getDialogs sync), we should NOT overwrite existing folder mapping in DB.
      const hasFolderData = chats.some(c => c.folderIds !== undefined)

      await tx
        .insert(accountJoinedChatsTable)
        .values(joinedChats.map((chat) => {
          const originalChat = chats.find(c => c.id.toString() === chat.chat_id)
          return {
            account_id: accountId,
            joined_chat_id: chat.id,
            is_pinned: originalChat?.pinned || false,
            is_contact: originalChat?.isContact || false,
            folder_ids: originalChat?.folderIds || [],
            access_hash: originalChat?.accessHash,
            pts: originalChat?.pts ?? 0,
          }
        }))
        .onConflictDoUpdate({
          target: [accountJoinedChatsTable.account_id, accountJoinedChatsTable.joined_chat_id],
          set: {
            is_pinned: sql`excluded.is_pinned`,
            is_contact: sql`excluded.is_contact`,
            ...(hasFolderData ? { folder_ids: sql`excluded.folder_ids` } : {}),
            access_hash: sql`excluded.access_hash`,
            pts: sql`CASE WHEN ${accountJoinedChatsTable.pts} = 0 THEN excluded.pts ELSE ${accountJoinedChatsTable.pts} END`,
          },
        })
    }

    return joinedChats
  })
}

/**
 * Fetch all chats
 */
async function fetchChats(db: CoreDB): PromiseResult<DBSelectChat[]> {
  return withResult(() => db.select()
    .from(joinedChatsTable)
    .where(eq(joinedChatsTable.platform, 'telegram'))
    .orderBy(desc(joinedChatsTable.dialog_date)),
  )
}

/**
 * Fetch chats for a specific account
 */
async function fetchChatsByAccountId(db: CoreDB, accountId: string): PromiseResult<DBSelectChatWithAccount[]> {
  return withResult(() => db
    .select({
      id: joinedChatsTable.id,
      platform: joinedChatsTable.platform,
      chat_id: joinedChatsTable.chat_id,
      chat_name: joinedChatsTable.chat_name,
      chat_type: joinedChatsTable.chat_type,
      chat_username: joinedChatsTable.chat_username,
      last_message_from_name: joinedChatsTable.last_message_from_name,
      last_message: joinedChatsTable.last_message,
      note: joinedChatsTable.note,
      dialog_date: joinedChatsTable.dialog_date,
      access_hash: accountJoinedChatsTable.access_hash,
      is_pinned: accountJoinedChatsTable.is_pinned,
      is_contact: accountJoinedChatsTable.is_contact,
      folder_ids: accountJoinedChatsTable.folder_ids,
      pts: accountJoinedChatsTable.pts,
      last_seen_platform_message_id: accountJoinedChatsTable.last_seen_platform_message_id,
      created_at: joinedChatsTable.created_at,
      updated_at: joinedChatsTable.updated_at,
    })
    .from(joinedChatsTable)
    .innerJoin(
      accountJoinedChatsTable,
      eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
    )
    .where(eq(accountJoinedChatsTable.account_id, accountId))
    .orderBy(desc(accountJoinedChatsTable.is_pinned), desc(joinedChatsTable.dialog_date)),
  )
}

/**
 * Check whether a given chat (by Telegram chat_id) is accessible for an account.
 *
 * This is used by higher-level handlers to enforce that message-level access
 * never exceeds the dialogs visible to the account.
 */
async function isChatAccessibleByAccount(db: CoreDB, accountId: string, chatId: string): PromiseResult<boolean> {
  return withResult(async () => {
    const rows = await db
      .select({
        id: joinedChatsTable.id,
      })
      .from(joinedChatsTable)
      .innerJoin(
        accountJoinedChatsTable,
        and(
          eq(accountJoinedChatsTable.joined_chat_id, joinedChatsTable.id),
          eq(accountJoinedChatsTable.account_id, accountId),
        ),
      )
      .where(eq(joinedChatsTable.chat_id, chatId))
      .limit(1)

    return rows.length > 0
  })
}

/**
 * Update the pts for a specific chat for an account.
 * Uses GREATEST() to ensure pts only moves forward.
 */
async function updateChatPts(db: CoreDB, accountId: string, chatId: string, pts: number): Promise<void> {
  // Find the joined_chat id first
  const chat = await db
    .select({ id: joinedChatsTable.id })
    .from(joinedChatsTable)
    .where(eq(joinedChatsTable.chat_id, chatId))
    .limit(1)

  if (chat.length === 0)
    return

  await db
    .update(accountJoinedChatsTable)
    .set({
      pts: sql`GREATEST(${accountJoinedChatsTable.pts}, ${pts})`,
    })
    .where(and(
      eq(accountJoinedChatsTable.account_id, accountId),
      eq(accountJoinedChatsTable.joined_chat_id, chat[0].id),
    ))
}



/**
 * For chats with no last-seen cursor yet, seed it to the latest stored message id.
 * Keeps historical backlog from flooding the sidebar unread badge on first load.
 */
async function ensureLastSeenBaselines(db: CoreDB, accountId: string): PromiseResult<number> {
  return withResult(async () => {
    const rows = await db
      .select({
        account_joined_chat_id: accountJoinedChatsTable.id,
        chat_id: joinedChatsTable.chat_id,
        chat_type: joinedChatsTable.chat_type,
        last_seen_platform_message_id: accountJoinedChatsTable.last_seen_platform_message_id,
      })
      .from(accountJoinedChatsTable)
      .innerJoin(
        joinedChatsTable,
        eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
      )
      .where(and(
        eq(accountJoinedChatsTable.account_id, accountId),
        sql`${accountJoinedChatsTable.last_seen_platform_message_id} IS NULL`,
      ))

    let updated = 0
    for (const row of rows) {
      const ownerScope = row.chat_type === 'user'
        ? sql`(
            ${chatMessagesTable.owner_account_id} = ${accountId}
            OR ${chatMessagesTable.owner_account_id} IS NULL
          )`
        : sql`true`

      const latest = await db
        .select({
          platform_message_id: sql<string | null>`max(case when ${chatMessagesTable.platform_message_id} ~ '^[0-9]+$' then ${chatMessagesTable.platform_message_id} end)`,
        })
        .from(chatMessagesTable)
        .where(and(
          eq(chatMessagesTable.in_chat_id, row.chat_id),
          eq(chatMessagesTable.platform, 'telegram'),
          eq(chatMessagesTable.deleted_at, 0),
          ownerScope,
        ))
        .limit(1)

      const latestId = latest[0]?.platform_message_id
      if (!latestId)
        continue

      await db
        .update(accountJoinedChatsTable)
        .set({ last_seen_platform_message_id: String(latestId) })
        .where(eq(accountJoinedChatsTable.id, row.account_joined_chat_id))
      updated += 1
    }

    return updated
  })
}

/**
 * Advance the local UI last-seen cursor for a chat.
 * Only moves forward (numeric Telegram message ids). Returns the stored cursor.
 */
async function markChatSeen(
  db: CoreDB,
  accountId: string,
  chatId: string,
  platformMessageId: string,
): PromiseResult<string | null> {
  return withResult(async () => {
    const trimmed = String(platformMessageId ?? '').trim()
    if (!trimmed || !/^[0-9]+$/.test(trimmed)) {
      return null
    }

    const chat = await db
      .select({ id: joinedChatsTable.id })
      .from(joinedChatsTable)
      .where(eq(joinedChatsTable.chat_id, chatId))
      .limit(1)

    if (chat.length === 0)
      return null

    const existing = await db
      .select({
        last_seen_platform_message_id: accountJoinedChatsTable.last_seen_platform_message_id,
      })
      .from(accountJoinedChatsTable)
      .where(and(
        eq(accountJoinedChatsTable.account_id, accountId),
        eq(accountJoinedChatsTable.joined_chat_id, chat[0].id),
      ))
      .limit(1)

    if (existing.length === 0)
      return null

    const current = existing[0].last_seen_platform_message_id
    if (current && /^[0-9]+$/.test(current) && BigInt(trimmed) <= BigInt(current)) {
      return current
    }

    await db
      .update(accountJoinedChatsTable)
      .set({ last_seen_platform_message_id: trimmed })
      .where(and(
        eq(accountJoinedChatsTable.account_id, accountId),
        eq(accountJoinedChatsTable.joined_chat_id, chat[0].id),
      ))

    return trimmed
  })
}

/**
 * Clear sync pts checkpoints for chats not in the sync whitelist.
 * Empty whitelist clears all pts for the account so catch-up never targets any chat.
 */
async function clearSyncPtsOutsideWhitelist(
  db: CoreDB,
  accountId: string,
  whitelistChatIds: string[],
): Promise<number> {
  const rows = await db
    .select({
      id: accountJoinedChatsTable.id,
      chat_id: joinedChatsTable.chat_id,
    })
    .from(accountJoinedChatsTable)
    .innerJoin(
      joinedChatsTable,
      eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
    )
    .where(and(
      eq(accountJoinedChatsTable.account_id, accountId),
      gt(accountJoinedChatsTable.pts, 0),
    ))

  const whitelistSet = new Set(whitelistChatIds.map(String))
  const toClear = rows
    .filter(row => !whitelistSet.has(String(row.chat_id)))
    .map(row => row.id)

  if (toClear.length === 0)
    return 0

  await db
    .update(accountJoinedChatsTable)
    .set({ pts: 0 })
    .where(inArray(accountJoinedChatsTable.id, toClear))

  return toClear.length
}

export const chatModels = {
  recordChats,
  fetchChats,
  fetchChatsByAccountId,
  isChatAccessibleByAccount,
  updateChatPts,
  markChatSeen,
  ensureLastSeenBaselines,
  clearSyncPtsOutsideWhitelist,
  findChatAccessHash,
  recordChatEntity,
  getOrModifyChatNote,
}

export type ChatModels = typeof chatModels

/**
 * Record a single chat entity (without dialog metadata)
 * Requires accountId to persist access_hash in account_joined_chats.
 */
async function recordChatEntity(db: CoreDB, entity: CoreEntity, accountId?: string): Promise<void> {
  let chatType: JoinedChatType = 'group'
  let chatUsername: string | null = null
  if (entity.type === 'channel') {
    chatType = 'channel'
    chatUsername = entity.username || null
  }

  const [chat] = await db.insert(joinedChatsTable)
    .values({
      platform: 'telegram',
      chat_id: entity.id,
      chat_name: entity.name,
      chat_type: chatType,
      chat_username: chatUsername,
      dialog_date: 0, // Not a dialog sync, so no date
    })
    .onConflictDoUpdate({
      target: joinedChatsTable.chat_id,
      set: {
        chat_name: sql`excluded.chat_name`,
        chat_username: sql`COALESCE(excluded.chat_username, ${joinedChatsTable.chat_username})`,
        updated_at: Date.now(),
      },
    })
    .returning()

  if (accountId && chat && entity.accessHash) {
    await db.insert(accountJoinedChatsTable)
      .values({
        account_id: accountId,
        joined_chat_id: chat.id,
        access_hash: entity.accessHash,
      })
      .onConflictDoUpdate({
        target: [accountJoinedChatsTable.account_id, accountJoinedChatsTable.joined_chat_id],
        set: {
          access_hash: sql`excluded.access_hash`,
        },
      })
  }
}

/**
 * Find access hash and type for a specific chat
 */
async function findChatAccessHash(db: CoreDB, accountId: string, chatId: string): PromiseResult<{ accessHash: string | null, type: string } | null> {
  return withResult(async () => {
    const rows = await db
      .select({
        access_hash: accountJoinedChatsTable.access_hash,
        type: joinedChatsTable.chat_type,
      })
      .from(joinedChatsTable)
      .innerJoin(
        accountJoinedChatsTable,
        and(
          eq(accountJoinedChatsTable.joined_chat_id, joinedChatsTable.id),
          eq(accountJoinedChatsTable.account_id, accountId),
        ),
      )
      .where(eq(joinedChatsTable.chat_id, chatId))
      .limit(1)

    if (rows.length === 0)
      return null
    return { accessHash: rows[0].access_hash, type: rows[0].type }
  })
}

async function getOrModifyChatNote(db: CoreDB, accountId: string, chatId: string, note: string, modify: boolean): Promise<string | null> {
  // Resolve joined_chats row for this account + chat_id (ensure account has access)
  const rows = await db
    .select({ id: joinedChatsTable.id, note: joinedChatsTable.note })
    .from(joinedChatsTable)
    .innerJoin(
      accountJoinedChatsTable,
      eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
    )
    .where(and(
      eq(joinedChatsTable.chat_id, chatId),
      eq(accountJoinedChatsTable.account_id, accountId),
    ))
    .limit(1)

  if (rows.length === 0)
    return null

  if (!modify)
    return rows[0].note ?? null

  const result = await db
    .update(joinedChatsTable)
    .set({ note })
    .where(eq(joinedChatsTable.id, rows[0].id))
    .returning()

  return result[0]?.note ?? null
}
