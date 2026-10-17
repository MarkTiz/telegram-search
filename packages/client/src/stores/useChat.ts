import type { CoreChatFolder, CoreDialog, CoreMessage } from '@tg-search/core'

import type { VersionedScopedStorage } from '../utils/versioned-local-cache'

import { useLogger } from '@guiiai/logg'
import { CoreEventType } from '@tg-search/core'
import { useLocalStorage } from '@vueuse/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { useBridge } from '../composables/useBridge'
import { readVersionedScopedCache, writeVersionedScopedCache } from '../utils/versioned-local-cache'
import { useSessionStore } from './useSession'

export const useChatStore = defineStore('chat', () => {
  const CHAT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
  const CHAT_CACHE_VERSION = 1
  const MAX_CACHED_CHAT_SCOPES = 8
  const sessionStore = useSessionStore()
  const bridge = useBridge()
  const allChats = useLocalStorage<VersionedScopedStorage<CoreDialog[]>>('v3/chat/chats', {})
  const allOnlineDialogs = useLocalStorage<VersionedScopedStorage<CoreDialog[]>>('v3/chat/online-dialogs', {})
  const allFolders = useLocalStorage<VersionedScopedStorage<CoreChatFolder[]>>('v3/chat/folders', {})
  const allPinnedOrders = useLocalStorage<VersionedScopedStorage<number[]>>('v3/chat/pinned-order', {})
  const logger = useLogger('ChatStore')

  /** Whether the open chat view is scrolled to the newest messages (for real-time local unread). */
  const viewingAtBottomByChatId = ref<Record<string, boolean>>({})
  const pendingMarkSeenTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const cacheOptions = {
    maxScopes: MAX_CACHED_CHAT_SCOPES,
    ttlMs: CHAT_CACHE_TTL_MS,
    version: CHAT_CACHE_VERSION,
  } as const

  const pinnedOrder = computed({
    get: () => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId) {
        return []
      }

      return readVersionedScopedCache(allPinnedOrders.value, String(userId), [], cacheOptions)
    },
    set: (v) => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId) {
        return
      }

      allPinnedOrders.value = writeVersionedScopedCache(allPinnedOrders.value, String(userId), v, cacheOptions)
    },
  })

  const chats = computed({
    get: () => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return []
      const list = readVersionedScopedCache(allChats.value, String(userId), [], cacheOptions).filter(chat => chat?.id != null)
      const pinnedRank = new Map(pinnedOrder.value.map((chatId, index) => [Number(chatId), index]))
      return [...list].sort((a, b) => {
        // Pinned chats first
        if (a.pinned && !b.pinned)
          return -1
        if (!a.pinned && b.pinned)
          return 1

        if (a.pinned && b.pinned) {
          return (pinnedRank.get(Number(a.id)) ?? Number.MAX_SAFE_INTEGER)
            - (pinnedRank.get(Number(b.id)) ?? Number.MAX_SAFE_INTEGER)
        }

        // Then by last message date
        const dateA = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0
        const dateB = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0
        return dateB - dateA
      })
    },
    set: (v) => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return

      allChats.value = writeVersionedScopedCache(allChats.value, String(userId), v, cacheOptions)
    },
  })

  /** Full Telegram online dialog list for whitelist pickers (not the main sidebar). */
  const onlineDialogs = computed({
    get: () => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return []
      return readVersionedScopedCache(allOnlineDialogs.value, String(userId), [], cacheOptions).filter(chat => chat?.id != null)
    },
    set: (v) => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return

      allOnlineDialogs.value = writeVersionedScopedCache(allOnlineDialogs.value, String(userId), v, cacheOptions)
    },
  })

  const folders = computed({
    get: () => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return []
      return readVersionedScopedCache(allFolders.value, String(userId), [], cacheOptions)
    },
    set: (v) => {
      const userId = sessionStore.activeSession?.me?.id
      if (!userId)
        return

      allFolders.value = writeVersionedScopedCache(allFolders.value, String(userId), v, cacheOptions)
    },
  })

  function getChat(id: string) {
    return chats.value.find(chat => chat.id === Number(id))
  }

  function isSamePreviewSnapshot(a: CoreDialog, b: CoreDialog) {
    const timeA = a.lastMessageDate ? new Date(a.lastMessageDate).getTime() : 0
    const timeB = b.lastMessageDate ? new Date(b.lastMessageDate).getTime() : 0

    return (a.lastMessage ?? '') === (b.lastMessage ?? '')
      && timeA === timeB
  }

  function mergeDialogs(dialogs: CoreDialog[], options: { preserveUnreadCount?: boolean, syncPinnedOrder?: boolean } = {}) {
    const existingChats = new Map(chats.value.map(chat => [chat.id, chat]))

    if (options.syncPinnedOrder) {
      pinnedOrder.value = dialogs.filter(chat => chat.pinned).map(chat => Number(chat.id))
    }

    chats.value = dialogs.map((incomingChat) => {
      const existingChat = existingChats.get(incomingChat.id)
      if (!existingChat) {
        return incomingChat
      }

      const incomingTime = incomingChat.lastMessageDate ? new Date(incomingChat.lastMessageDate).getTime() : 0
      const existingTime = existingChat.lastMessageDate ? new Date(existingChat.lastMessageDate).getTime() : 0
      const keepNewerPreview = existingTime > incomingTime

      const shouldReuseSenderName = !incomingChat.lastMessageFromName
        && !!existingChat.lastMessageFromName
        && isSamePreviewSnapshot(existingChat, incomingChat)

      return {
        ...incomingChat,
        // Prefer fresher local preview (live MessageData) over stale DB snapshot.
        ...(keepNewerPreview
          ? {
              lastMessage: existingChat.lastMessage,
              lastMessageFromName: existingChat.lastMessageFromName,
              lastMessageDate: existingChat.lastMessageDate,
            }
          : {}),
        // Telegram-sourced dialog lists carry no messageCount; keep the DB-derived one
        ...(incomingChat.messageCount == null && existingChat.messageCount != null
          ? { messageCount: existingChat.messageCount }
          : {}),
        ...(shouldReuseSenderName && !keepNewerPreview ? { lastMessageFromName: existingChat.lastMessageFromName } : {}),
        ...(options.preserveUnreadCount && existingChat.unreadCount != null
          ? { unreadCount: existingChat.unreadCount }
          : {}),
      }
    })
  }

  function setOnlineDialogs(dialogs: CoreDialog[]) {
    onlineDialogs.value = dialogs
  }

  function syncPinnedOrder(pinnedDialogIds: number[]) {
    pinnedOrder.value = pinnedDialogIds.map(id => Number(id)).filter(Number.isFinite)
  }

  function setChatViewingAtBottom(chatId: string, atBottom: boolean) {
    viewingAtBottomByChatId.value = {
      ...viewingAtBottomByChatId.value,
      [String(chatId)]: atBottom,
    }
  }

  function isViewingChatAtBottom(chatId: string) {
    return viewingAtBottomByChatId.value[String(chatId)] === true
  }

  function clearChatViewingState(chatId: string) {
    const key = String(chatId)
    if (!(key in viewingAtBottomByChatId.value))
      return
    const next = { ...viewingAtBottomByChatId.value }
    delete next[key]
    viewingAtBottomByChatId.value = next
  }

  function applyLocalUnread(chatId: string | number, unreadCount: number) {
    const id = Number(chatId)
    const nextChats = [...chats.value]
    const idx = nextChats.findIndex(chat => Number(chat.id) === id)
    if (idx < 0)
      return
    if ((nextChats[idx].unreadCount ?? 0) === unreadCount)
      return
    nextChats[idx] = { ...nextChats[idx], unreadCount }
    chats.value = nextChats
  }

  /**
   * Persist last-seen and clear local unread for a chat.
   * Debounced so scroll/realtime catch-up does not spam the server.
   */
  function markChatSeen(chatId: string, platformMessageId?: string | number | null, options: { immediate?: boolean } = {}) {
    const id = String(chatId)
    const messageId = platformMessageId != null ? String(platformMessageId).trim() : ''
    if (!messageId || !/^[0-9]+$/.test(messageId)) {
      return
    }

    applyLocalUnread(id, 0)

    const send = () => {
      pendingMarkSeenTimers.delete(id)
      bridge.sendEvent(CoreEventType.StorageMarkChatSeen, {
        chatId: id,
        platformMessageId: messageId,
      })
    }

    const existing = pendingMarkSeenTimers.get(id)
    if (existing)
      clearTimeout(existing)

    if (options.immediate) {
      send()
      return
    }

    pendingMarkSeenTimers.set(id, setTimeout(send, 250))
  }

  function getMessagePreview(message: CoreMessage) {
    const text = message.content?.trim()
    if (text) {
      return text
    }

    const media = message.media?.[0]
    if (!media) {
      return ''
    }

    switch (media.type) {
      case 'sticker':
        return media.emoji?.trim() || 'Sticker'
      case 'photo':
        return 'Photo'
      case 'document':
        if (media.mimeType?.startsWith('audio/')) {
          return 'Audio'
        }
        if (media.mimeType?.startsWith('video/')) {
          return 'Video'
        }
        return 'File'
      case 'webpage':
        return media.title?.trim() || 'Link'
      default:
        return 'Message'
    }
  }

  function updateChatPreviewFromMessages(
    messages: CoreMessage[],
    options: {
      activeChatId?: string
      currentUserId?: string
      incrementUnread?: boolean
    } = {},
  ) {
    if (messages.length === 0) {
      return
    }

    const nextChats = [...chats.value]
    let hasChanges = false
    const seenTargets = new Map<string, string>()

    for (const message of messages) {
      const chatId = Number(message.chatId)
      if (!Number.isFinite(chatId)) {
        continue
      }

      const chatIndex = nextChats.findIndex(chat => chat.id === chatId)
      if (chatIndex < 0) {
        continue
      }

      const chat = nextChats[chatIndex]
      const messageDate = new Date(message.platformTimestamp * 1000)
      const currentDate = chat.lastMessageDate ? new Date(chat.lastMessageDate) : undefined

      const isActiveChat = options.activeChatId === message.chatId
      const viewingLatest = isActiveChat && isViewingChatAtBottom(message.chatId)
      const shouldClearUnread = viewingLatest
      const shouldIncrement = !shouldClearUnread
        && !!options.incrementUnread
        && options.currentUserId !== message.fromId

      if (shouldClearUnread && message.platformMessageId) {
        const prev = seenTargets.get(message.chatId)
        if (!prev || BigInt(message.platformMessageId) > BigInt(prev)) {
          seenTargets.set(message.chatId, String(message.platformMessageId))
        }
      }

      if (currentDate && currentDate.getTime() > messageDate.getTime()) {
        if (shouldClearUnread || shouldIncrement) {
          nextChats[chatIndex] = {
            ...chat,
            unreadCount: shouldClearUnread
              ? 0
              : (chat.unreadCount ?? 0) + 1,
          }
          hasChanges = true
        }
        continue
      }

      nextChats[chatIndex] = {
        ...chat,
        lastMessageFromName: message.fromName,
        lastMessage: getMessagePreview(message),
        lastMessageDate: messageDate,
        unreadCount: shouldClearUnread
          ? 0
          : shouldIncrement
            ? (chat.unreadCount ?? 0) + 1
            : chat.unreadCount,
      }
      hasChanges = true
    }

    if (hasChanges) {
      chats.value = nextChats
    }

    for (const [chatId, platformMessageId] of seenTargets) {
      markChatSeen(chatId, platformMessageId)
    }
  }

  function fetchStorageDialogs() {
    bridge.sendEvent(CoreEventType.StorageFetchDialogs)
  }

  /** Refresh Telegram online dialogs for whitelist UIs only — does not drive the main sidebar. */
  function fetchOnlineDialogs() {
    void bridge.application.listChats({ limit: 1000 }).then((result) => {
      if (!result.ok) {
        throw new Error(`${result.error.code}: ${result.error.message}`)
      }
      setOnlineDialogs(result.data.items.map(chat => ({
        id: Number(chat.id),
        name: chat.name,
        type: chat.type,
        username: chat.username,
        lastMessage: chat.lastMessage,
        lastMessageDate: chat.lastMessageAt ? new Date(chat.lastMessageAt * 1000) : undefined,
      })))
    }).catch(error => logger.withError(error).error('Failed to fetch online dialogs through Eventa'))
  }

  /** @deprecated Use fetchOnlineDialogs for whitelist; main list uses fetchStorageDialogs. */
  function fetchDialogs() {
    fetchOnlineDialogs()
  }

  function fetchFolders() {
    logger.log('Fetching folders')
    bridge.sendEvent(CoreEventType.DialogFoldersFetch)
  }

  function init() {
    logger.log('Init dialogs (local sidebar + online whitelist)')

    fetchStorageDialogs()
    fetchOnlineDialogs()
    fetchFolders()
  }

  return {
    init,
    getChat,
    mergeDialogs,
    setOnlineDialogs,
    syncPinnedOrder,
    fetchDialogs,
    fetchOnlineDialogs,
    fetchStorageDialogs,
    fetchFolders,
    updateChatPreviewFromMessages,
    markChatSeen,
    setChatViewingAtBottom,
    isViewingChatAtBottom,
    clearChatViewingState,
    applyLocalUnread,
    chats,
    onlineDialogs,
    folders,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useChatStore, import.meta.hot))
}
