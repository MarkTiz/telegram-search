import { describe, expect, it } from 'vitest'

import { generateDefaultAccountSettings, isChatAllowedBySyncWhitelist } from '../account-settings'

describe('isChatAllowedBySyncWhitelist', () => {
  it('denies all chats when whitelist is empty', () => {
    const settings = generateDefaultAccountSettings()
    expect(isChatAllowedBySyncWhitelist(settings, '123')).toBe(false)
    expect(isChatAllowedBySyncWhitelist(settings, 456)).toBe(false)
  })

  it('allows only listed chats when whitelist is non-empty', () => {
    const settings = generateDefaultAccountSettings()
    settings.messageProcessing!.whitelistChatIds = ['111', '222']
    expect(isChatAllowedBySyncWhitelist(settings, '111')).toBe(true)
    expect(isChatAllowedBySyncWhitelist(settings, 222)).toBe(true)
    expect(isChatAllowedBySyncWhitelist(settings, '333')).toBe(false)
    expect(isChatAllowedBySyncWhitelist(settings, '')).toBe(false)
    expect(isChatAllowedBySyncWhitelist(settings, null)).toBe(false)
  })
})
