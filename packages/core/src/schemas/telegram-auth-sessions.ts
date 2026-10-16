import { bigint, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

import { accountsTable } from './accounts'

/**
 * Durable GramJS StringSession material for server mode.
 *
 * `id` is the WebSocket account slot (one runtime, one stored session).
 * `account_id` links that slot to the Telegram user row after login.
 * The ciphertext is AES-256-GCM output, never the raw StringSession.
 */
export const telegramAuthSessionsTable = pgTable('telegram_auth_sessions', {
  id: text().primaryKey(),
  account_id: uuid().references(() => accountsTable.id, { onDelete: 'set null' }),
  session_ciphertext: text().notNull(),
  telegram_user_id: text(),
  display_name: text(),
  created_at: bigint({ mode: 'number' }).notNull().$defaultFn(() => Date.now()),
  updated_at: bigint({ mode: 'number' }).notNull().$defaultFn(() => Date.now()),
}, table => [
  uniqueIndex('telegram_auth_sessions_account_id_unique_index').on(table.account_id),
])
