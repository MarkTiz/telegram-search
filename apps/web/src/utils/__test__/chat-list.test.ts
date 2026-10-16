import type { CoreChatFolder, CoreDialog } from '@tg-search/core'

import { describe, expect, it } from 'vitest'

import { filterFoldersByChats, matchesFolder } from '../chat-list'

function folder(partial: Partial<CoreChatFolder> & Pick<CoreChatFolder, 'id' | 'title'>): CoreChatFolder {
  return {
    includedChatIds: [],
    excludedChatIds: [],
    ...partial,
  }
}

function chat(partial: Partial<CoreDialog> & Pick<CoreDialog, 'id' | 'type'>): CoreDialog {
  return {
    name: `chat-${partial.id}`,
    ...partial,
  }
}

describe('filterFoldersByChats', () => {
  it('returns empty when whitelist chats are empty', () => {
    const folders = [folder({ id: 1, title: 'A', includedChatIds: [10] })]
    expect(filterFoldersByChats(folders, [])).toEqual([])
  })

  it('keeps only folders that match at least one chat', () => {
    const folders = [
      folder({ id: 1, title: 'Keep', includedChatIds: [10] }),
      folder({ id: 2, title: 'Drop', includedChatIds: [99] }),
      folder({ id: 3, title: 'Groups', groups: true }),
    ]
    const chats = [
      chat({ id: 10, type: 'channel' }),
      chat({ id: 20, type: 'supergroup' }),
    ]

    expect(filterFoldersByChats(folders, chats).map(f => f.id)).toEqual([1, 3])
  })

  it('matchesFolder respects excluded ids', () => {
    const f = folder({ id: 1, title: 'X', includedChatIds: [10], excludedChatIds: [10] })
    expect(matchesFolder(chat({ id: 10, type: 'channel' }), f)).toBe(false)
  })
})
