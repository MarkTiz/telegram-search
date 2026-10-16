import type { AccountSettings, CoreDB, Models } from '@tg-search/core'

import { getAgentApiChatIds, isAgentApiEnabled } from '@tg-search/core'

export interface AgentAccountScope {
  accountId: string
  platform: string
  platformUserId: string
  settings: AccountSettings
  /** Agent API allowlist chat IDs (already pruned to sync whitelist). */
  chatIds: string[]
}

export interface AgentScopeResolution {
  /** True when any account has agentApi.enabled. */
  enabled: boolean
  accounts: AgentAccountScope[]
}

/**
 * Resolve cross-account agent API scopes from DB settings.
 * When `accountIds` is provided, only those accounts are considered.
 */
export async function resolveAgentScopes(
  db: CoreDB,
  models: Models,
  accountIds?: string[] | null,
): Promise<AgentScopeResolution> {
  const rows = (await models.accountSettingsModels.listAllAccountsWithSettings(db))
    .expect('Failed to list accounts for agent API')

  const enabled = rows.some(row => isAgentApiEnabled(row.settings))

  let filtered = rows
  if (accountIds != null && accountIds.length > 0) {
    const wanted = new Set(accountIds.map(String))
    filtered = rows.filter(row => wanted.has(row.id))
  }

  const accounts: AgentAccountScope[] = filtered.map(row => ({
    accountId: row.id,
    platform: row.platform,
    platformUserId: row.platformUserId,
    settings: row.settings,
    chatIds: getAgentApiChatIds(row.settings),
  }))

  return { enabled, accounts }
}

/**
 * Intersect request chatIds (if any) with an account's agent allowlist.
 * Empty allowlist => empty (strict).
 */
export function intersectAgentChatIds(
  allowlist: string[],
  requestChatIds?: string[] | null,
): string[] {
  if (allowlist.length === 0)
    return []
  if (requestChatIds == null || requestChatIds.length === 0)
    return [...allowlist]
  const allowed = new Set(allowlist.map(String))
  return requestChatIds.map(String).filter(id => allowed.has(id))
}

/** Flat set of all allowed chat IDs across scopes (for photo filtering). */
export function collectAllowedChatIdSet(scopes: AgentAccountScope[]): Set<string> {
  const set = new Set<string>()
  for (const scope of scopes) {
    for (const id of scope.chatIds)
      set.add(String(id))
  }
  return set
}

export function findScopeForChat(
  scopes: AgentAccountScope[],
  chatId: string,
  preferredAccountId?: string | null,
): AgentAccountScope | undefined {
  const id = String(chatId)
  if (preferredAccountId) {
    const preferred = scopes.find(s => s.accountId === preferredAccountId && s.chatIds.includes(id))
    if (preferred)
      return preferred
  }
  return scopes.find(s => s.chatIds.includes(id))
}
