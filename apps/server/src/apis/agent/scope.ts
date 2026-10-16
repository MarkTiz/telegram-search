import type { CoreDB, GlobalAgentApiConfig, Models } from '@tg-search/core'

export interface AgentAllowEntry {
  accountId: string
  chatId: string
}

export interface AgentScopeResolution {
  enabled: boolean
  /** Global allowlist entries (already filtered by optional accountIds). */
  entries: AgentAllowEntry[]
}

/**
 * Resolve global agent API scope.
 * Optional `accountIds` further restricts which entries are active for a request.
 */
export async function resolveAgentScopes(
  db: CoreDB,
  models: Models,
  accountIds?: string[] | null,
): Promise<AgentScopeResolution> {
  const config = (await models.appSettingsModels.getAgentApiConfig(db))
    .expect('Failed to load global agent API config')

  let entries = (config.entries ?? []).map(entry => ({
    accountId: String(entry.accountId),
    chatId: String(entry.chatId),
  }))

  if (accountIds != null && accountIds.length > 0) {
    const wanted = new Set(accountIds.map(String))
    entries = entries.filter(entry => wanted.has(entry.accountId))
  }

  return {
    enabled: config.enabled === true,
    entries,
  }
}

export function chatIdsForAccount(entries: AgentAllowEntry[], accountId: string): string[] {
  return entries.filter(e => e.accountId === accountId).map(e => e.chatId)
}

/**
 * Intersect request chatIds (if any) with allowlisted chat IDs for one account.
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

export function collectAllowedChatIdSet(entries: AgentAllowEntry[]): Set<string> {
  return new Set(entries.map(e => String(e.chatId)))
}

export function findEntryForChat(
  entries: AgentAllowEntry[],
  chatId: string,
  preferredAccountId?: string | null,
): AgentAllowEntry | undefined {
  const id = String(chatId)
  if (preferredAccountId) {
    const preferred = entries.find(e => e.accountId === preferredAccountId && e.chatId === id)
    if (preferred)
      return preferred
  }
  return entries.find(e => e.chatId === id)
}

/** One-time merge of legacy per-account agentApi into global store when global is empty. */
export async function migrateLegacyAgentApiIfNeeded(
  db: CoreDB,
  models: Models,
): Promise<GlobalAgentApiConfig> {
  const current = (await models.appSettingsModels.getAgentApiConfig(db))
    .expect('Failed to load global agent API config')

  if (current.entries.length > 0 || current.enabled) {
    return current
  }

  const rows = (await models.accountSettingsModels.listAllAccountsWithSettings(db))
    .expect('Failed to list accounts for agent API migration')

  const entries: AgentAllowEntry[] = []
  let enabled = false
  for (const row of rows) {
    if (row.settings.agentApi?.enabled)
      enabled = true
    for (const chatId of row.settings.agentApi?.chatIds ?? []) {
      entries.push({ accountId: row.id, chatId: String(chatId) })
    }
  }

  if (!enabled && entries.length === 0)
    return current

  return (await models.appSettingsModels.setAgentApiConfig(db, { enabled, entries }))
    .expect('Failed to migrate legacy agent API config')
}
