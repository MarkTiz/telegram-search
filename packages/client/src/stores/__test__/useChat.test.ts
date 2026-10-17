import { CoreEventType } from '@tg-search/core'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatStore } from '../useChat'

// Mock dependencies
const sendEventMock = vi.fn()
const listChatsMock = vi.fn(async () => ({ ok: true, data: { items: [], nextCursor: null } }))
vi.mock('../../composables/useBridge', () => ({
  useBridge: () => ({
    sendEvent: sendEventMock,
    application: { listChats: listChatsMock },
  }),
}))

vi.mock('../useSession', () => ({
  useSessionStore: vi.fn(() => ({
    activeSession: { me: { id: 12345 } },
  })),
}))

// Mock localStorage
const localStorageMock = new Map<string, any>()
vi.mock('@vueuse/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vueuse/core')>()
  return {
    ...actual,
    useLocalStorage: (key: string, initialValue: any) => {
      // Reactive ref so Pinia computed getters invalidate after writes.
      if (!localStorageMock.has(key))
        localStorageMock.set(key, ref(initialValue))
      return localStorageMock.get(key)
    },
  }
})

describe('useChatStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorageMock.clear()
    vi.clearAllMocks()
  })

  it('initializes and fetches data', () => {
    const store = useChatStore()
    store.init()

    expect(sendEventMock).toHaveBeenCalledWith(CoreEventType.StorageFetchDialogs)
    expect(sendEventMock).toHaveBeenCalledWith(CoreEventType.DialogFoldersFetch)
    expect(listChatsMock).toHaveBeenCalledWith({ limit: 1000 })
  })

  it('manages chats correctly', () => {
    const store = useChatStore()
    const mockChats = [
      { id: 1, title: 'Chat 1', pinned: false, lastMessageDate: '2023-01-01' },
      { id: 2, title: 'Chat 2', pinned: true, lastMessageDate: '2023-01-02' },
    ]

    // @ts-expect-error - mock data
    store.chats = mockChats

    // Check getter logic (sorting)
    // Chat 2 is pinned, should be first
    expect(store.chats[0].id).toBe(2)
    expect(store.chats[1].id).toBe(1)
  })

  it('gets a specific chat', () => {
    const store = useChatStore()
    const mockChats = [
      { id: 1, name: 'Chat 1' },
      { id: 2, name: 'Chat 2' },
    ]
    // @ts-expect-error - mock data
    store.chats = mockChats

    const chat = store.getChat('1')
    expect(chat).toBeDefined()
    expect(chat?.name).toBe('Chat 1')
  })

  it('manages folders correctly', () => {
    const store = useChatStore()
    const mockFolders = [
      { id: 1, title: 'Folder 1', includedChatIds: [], excludedChatIds: [] },
    ]

    store.folders = mockFolders

    expect(store.folders).toHaveLength(1)
    expect(store.folders[0].title).toBe('Folder 1')
  })

  it('keeps online dialogs separate from local chats', () => {
    const store = useChatStore()
    store.setOnlineDialogs([
      { id: 99, name: 'Online Only', type: 'group' },
    ] as any)
    store.chats = [
      { id: 1, name: 'Local Chat', type: 'group', unreadCount: 3 },
    ] as any

    expect(store.onlineDialogs).toHaveLength(1)
    expect(store.onlineDialogs[0].id).toBe(99)
    expect(store.chats).toHaveLength(1)
    expect(store.chats[0].id).toBe(1)
  })

  it('markChatSeen clears local unread and emits StorageMarkChatSeen', () => {
    const store = useChatStore()
    store.chats = [
      { id: 7, name: 'Chat', type: 'group', unreadCount: 5 },
    ] as any

    store.markChatSeen('7', '12345', { immediate: true })
    expect(store.getChat('7')?.unreadCount).toBe(0)
    expect(sendEventMock).toHaveBeenCalledWith(CoreEventType.StorageMarkChatSeen, {
      chatId: '7',
      platformMessageId: '12345',
    })
  })

})
