import type { AccountSettings } from '@tg-search/core'
import type { CoreDialog } from '@tg-search/core/types'

/** Strict whitelist: empty => no chats allowed. */
export function getWhitelistChatIdSet(settings: AccountSettings | undefined | null): Set<string> {
  const ids = settings?.messageProcessing?.whitelistChatIds ?? []
  return new Set(ids.map(String))
}

export function filterChatsByWhitelist<T extends { id: number | string }>(
  chats: T[],
  settings: AccountSettings | undefined | null,
): T[] {
  const allowed = getWhitelistChatIdSet(settings)
  if (allowed.size === 0)
    return []
  return chats.filter(chat => allowed.has(String(chat.id)))
}

export function filterDialogsByWhitelist(
  dialogs: CoreDialog[],
  settings: AccountSettings | undefined | null,
): CoreDialog[] {
  return filterChatsByWhitelist(dialogs, settings)
}

/**
 * Chat IDs to send for AI search/photo tools.
 * - Empty whitelist => [] (caller should short-circuit; server treats [] as unfiltered)
 * - No UI selection => all whitelist IDs
 * - With selection => intersection with whitelist
 */
export function resolveWhitelistedSearchChatIds(
  selectedChatIds: Array<number | string>,
  settings: AccountSettings | undefined | null,
): string[] {
  const allowed = getWhitelistChatIdSet(settings)
  if (allowed.size === 0)
    return []
  if (selectedChatIds.length === 0)
    return [...allowed]
  return selectedChatIds.map(String).filter(id => allowed.has(id))
}
