import type { CoreDB } from '../db'
import type { PromiseResult } from '../utils/result'
import type { DBSelectChatMessageStats } from './utils/types'

import { and, count, eq, max, min, sql } from 'drizzle-orm'

import { accountJoinedChatsTable } from '../schemas/account-joined-chats'
import { chatMessagesTable } from '../schemas/chat-messages'
import { joinedChatsTable } from '../schemas/joined-chats'
import { withResult } from '../utils/result'
import { must0 } from './utils/must'

function normalizeNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function normalizeStatsRow<T extends {
  message_count: unknown
  first_message_id: unknown
  first_message_at: unknown
  latest_message_id: unknown
  latest_message_at: unknown
}>(row: T): T & {
  message_count: number
  first_message_id: number | null
  first_message_at: number | null
  latest_message_id: number | null
  latest_message_at: number | null
} {
  const messageCount = normalizeNullableNumber(row.message_count) ?? 0
  return {
    ...row,
    message_count: messageCount,
    first_message_id: normalizeNullableNumber(row.first_message_id),
    first_message_at: normalizeNullableNumber(row.first_message_at),
    latest_message_id: normalizeNullableNumber(row.latest_message_id),
    latest_message_at: normalizeNullableNumber(row.latest_message_at),
  }
}

// Telegram message IDs are numeric, but this column also contains legacy text.
// Cast only digit-only IDs so malformed rows do not make the aggregate fail.
const firstNumericMessageId = sql<number | null>`min(case when ${chatMessagesTable.platform_message_id} ~ '^[0-9]+$' then (${chatMessagesTable.platform_message_id})::bigint end)`
const latestNumericMessageId = sql<number | null>`max(case when ${chatMessagesTable.platform_message_id} ~ '^[0-9]+$' then (${chatMessagesTable.platform_message_id})::bigint end)`

/**
 * Get per-chat message stats for a specific logical account.
 *
 * - For private chats (chat_type = 'user'), only messages owned by this account
 *   (or legacy NULL owner) are counted.
 * - For group/channel chats, messages are shared across accounts and the count
 *   is global (owner_account_id is NULL by design).
 */
async function getChatMessagesStats(db: CoreDB, accountId: string): PromiseResult<DBSelectChatMessageStats[]> {
  return withResult(async () => {
    const rows = await db
      .select({
        platform: joinedChatsTable.platform,
        chat_id: joinedChatsTable.chat_id,
        chat_name: joinedChatsTable.chat_name,
        message_count: count(chatMessagesTable.id).as('message_count'),
        first_message_id: firstNumericMessageId.as('first_message_id'),
        first_message_at: min(chatMessagesTable.created_at).as('first_message_at'),
        latest_message_id: latestNumericMessageId.as('latest_message_id'),
        latest_message_at: max(chatMessagesTable.created_at).as('latest_message_at'),
      })
      .from(joinedChatsTable)
      .leftJoin(
        chatMessagesTable,
        and(
          eq(joinedChatsTable.chat_id, chatMessagesTable.in_chat_id),
          eq(chatMessagesTable.platform, 'telegram'),
          eq(chatMessagesTable.deleted_at, 0),
          sql`(
            ${joinedChatsTable.chat_type} != 'user'
            OR ${chatMessagesTable.owner_account_id} = ${accountId}
            OR ${chatMessagesTable.owner_account_id} IS NULL
          )`,
        ),
      )
      .where(eq(joinedChatsTable.platform, 'telegram'))
      .groupBy(
        joinedChatsTable.platform,
        joinedChatsTable.chat_id,
        joinedChatsTable.chat_name,
      )

    return rows.map(normalizeStatsRow)
  })
}

/**
 * Get per-chat message stats for a specific chat.
 */
async function getChatMessageStatsByChatId(db: CoreDB, accountId: string, chatId: string): PromiseResult<DBSelectChatMessageStats> {
  return withResult(async () => {
    const rows = await db
      .select({
        platform: joinedChatsTable.platform,
        chat_id: joinedChatsTable.chat_id,
        chat_name: joinedChatsTable.chat_name,
        message_count: count(chatMessagesTable.id).as('message_count'),
        first_message_id: firstNumericMessageId.as('first_message_id'),
        first_message_at: min(chatMessagesTable.created_at).as('first_message_at'),
        latest_message_id: latestNumericMessageId.as('latest_message_id'),
        latest_message_at: max(chatMessagesTable.created_at).as('latest_message_at'),
      })
      .from(joinedChatsTable)
      .leftJoin(
        chatMessagesTable,
        and(
          eq(joinedChatsTable.chat_id, chatMessagesTable.in_chat_id),
          eq(chatMessagesTable.platform, 'telegram'),
          eq(chatMessagesTable.deleted_at, 0),
          sql`(
          ${joinedChatsTable.chat_type} != 'user'
          OR ${chatMessagesTable.owner_account_id} = ${accountId}
          OR ${chatMessagesTable.owner_account_id} IS NULL
        )`,
        ),
      )
      .where(
        and(
          eq(joinedChatsTable.platform, 'telegram'),
          eq(joinedChatsTable.chat_id, chatId),
        ),
      )
      .groupBy(
        joinedChatsTable.platform,
        joinedChatsTable.chat_id,
        joinedChatsTable.chat_name,
      )
      .limit(1)

    return normalizeStatsRow(must0(rows))
  })
}


/**
 * Count local messages newer than each chat's last-seen cursor for an account.
 * Chats with a null last-seen cursor are treated as caught up (omitted / unread 0).
 */
async function getLocalUnreadCounts(
  db: CoreDB,
  accountId: string,
): PromiseResult<Array<{ chat_id: string, unread_count: number }>> {
  return withResult(async () => {
    const rows = await db
      .select({
        chat_id: joinedChatsTable.chat_id,
        unread_count: count(chatMessagesTable.id).as('unread_count'),
      })
      .from(accountJoinedChatsTable)
      .innerJoin(
        joinedChatsTable,
        eq(joinedChatsTable.id, accountJoinedChatsTable.joined_chat_id),
      )
      .innerJoin(
        chatMessagesTable,
        and(
          eq(chatMessagesTable.in_chat_id, joinedChatsTable.chat_id),
          eq(chatMessagesTable.platform, 'telegram'),
          eq(chatMessagesTable.deleted_at, 0),
          sql`${accountJoinedChatsTable.last_seen_platform_message_id} ~ '^[0-9]+$'`,
          sql`${chatMessagesTable.platform_message_id} ~ '^[0-9]+$'`,
          sql`(${chatMessagesTable.platform_message_id})::bigint > (${accountJoinedChatsTable.last_seen_platform_message_id})::bigint`,
          sql`(
            ${joinedChatsTable.chat_type} != 'user'
            OR ${chatMessagesTable.owner_account_id} = ${accountId}
            OR ${chatMessagesTable.owner_account_id} IS NULL
          )`,
        ),
      )
      .where(and(
        eq(accountJoinedChatsTable.account_id, accountId),
        eq(joinedChatsTable.platform, 'telegram'),
      ))
      .groupBy(joinedChatsTable.chat_id)

    return rows.map(row => ({
      chat_id: row.chat_id,
      unread_count: Number(row.unread_count) || 0,
    }))
  })
}

export const chatMessageStatsModels = {
  getChatMessagesStats,
  getChatMessageStatsByChatId,
  getLocalUnreadCounts,
}

export type ChatMessageStatsModels = typeof chatMessageStatsModels
