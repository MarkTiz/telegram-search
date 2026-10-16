import { bigint, jsonb, pgTable, text } from 'drizzle-orm/pg-core'

/**
 * Singleton-ish key/value server settings (not per Telegram account).
 * Used for global Agent API allowlist and similar cross-account config.
 */
export const appSettingsTable = pgTable('app_settings', {
  key: text().primaryKey(),
  value: jsonb().$type<unknown>().notNull(),
  updated_at: bigint({ mode: 'number' }).notNull().$defaultFn(() => Date.now()),
})
