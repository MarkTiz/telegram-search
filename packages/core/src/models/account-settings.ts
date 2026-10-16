import type { CoreDB } from '../db'
import type { AccountSettings } from '../types/account-settings'
import type { PromiseResult } from '../utils/result'
import type { DBInsertAccount } from './utils/types'

import { eq } from 'drizzle-orm'
import { safeParse } from 'valibot'

import { accountsTable } from '../schemas/accounts'
import { accountSettingsSchema } from '../types/account-settings'
import { generateDefaultAccountSettings, normalizeAccountSettings } from '../utils/account-settings'
import { withResult } from '../utils/result'
import { must0 } from './utils/must'

/**
 * Update settings for a specific account
 */
async function updateAccountSettings(
  db: CoreDB,
  accountId: string,
  settings: Partial<AccountSettings>,
): Promise<DBInsertAccount> {
  const parsedSettings = safeParse(accountSettingsSchema, settings)
  if (!parsedSettings.success) {
    throw new Error('Invalid settings', { cause: parsedSettings.issues })
  }

  const normalized = normalizeAccountSettings(parsedSettings.output)

  // Only update the "settings" column (which is a JSONB), not the root row fields
  const updatedRows = await db
    .update(accountsTable)
    .set({ settings: normalized })
    .where(eq(accountsTable.id, accountId))
    .returning()

  return must0(updatedRows)
}

/**
 * Fetch settings by accountId
 */
async function fetchSettingsByAccountId(db: CoreDB, accountId: string): PromiseResult<AccountSettings> {
  return withResult(async () => {
    const result = await db
      .select({ settings: accountsTable.settings })
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .limit(1)

    if (result.length > 0 && result[0].settings) {
      const parsedSettings = safeParse(accountSettingsSchema, result[0].settings)
      if (parsedSettings.success) {
        return normalizeAccountSettings(parsedSettings.output)
      }
    }

    return generateDefaultAccountSettings()
  })
}

export interface AccountWithSettings {
  id: string
  platform: string
  platformUserId: string
  settings: AccountSettings
}

/**
 * List every account with normalized settings (for cross-account agent API).
 */
async function listAllAccountsWithSettings(db: CoreDB): PromiseResult<AccountWithSettings[]> {
  return withResult(async () => {
    const rows = await db
      .select({
        id: accountsTable.id,
        platform: accountsTable.platform,
        platformUserId: accountsTable.platform_user_id,
        settings: accountsTable.settings,
      })
      .from(accountsTable)

    return rows.map((row) => {
      const parsed = safeParse(accountSettingsSchema, row.settings ?? {})
      const settings = normalizeAccountSettings(parsed.success ? parsed.output : generateDefaultAccountSettings())
      return {
        id: row.id,
        platform: row.platform,
        platformUserId: row.platformUserId,
        settings,
      }
    })
  })
}

export const accountSettingsModels = {
  updateAccountSettings,
  fetchSettingsByAccountId,
  listAllAccountsWithSettings,
}

export type AccountSettingsModels = typeof accountSettingsModels
