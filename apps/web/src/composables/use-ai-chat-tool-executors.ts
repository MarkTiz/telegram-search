import type { CoreDialog, CoreRetrievalPhoto } from '@tg-search/core/types'
import type { Ref } from 'vue'

import type {
  ChatNoteParams,
  GetDialogsParams,
  RetrieveContextParams,
  SearchMessagesParams,
  SearchPhotosParams,
} from './useAIChat'

import { useLogger } from '@guiiai/logg'
import { useAccountStore, useBridge, waitForEventWithTimeout } from '@tg-search/client'
import { storeToRefs } from 'pinia'
import { CoreEventType } from '@tg-search/core'

import { filterDialogsByWhitelist, resolveWhitelistedSearchChatIds } from '../utils/sync-whitelist'

function createRequestId() {
  return `ai-chat:${Date.now()}:${Math.random().toString(36).slice(2)}`
}

interface UseAIChatToolExecutorsOptions {
  selectedChatIds: Ref<number[]>
}

export function useAIChatToolExecutors({ selectedChatIds }: UseAIChatToolExecutorsOptions) {
  const bridge = useBridge()
  const logger = useLogger('composables:ai-chat')
  const { accountSettings } = storeToRefs(useAccountStore())

  function scopedChatIds() {
    return resolveWhitelistedSearchChatIds(selectedChatIds.value, accountSettings.value)
  }

  async function searchMessages(params: SearchMessagesParams) {
    const requestId = createRequestId()
    const chatIds = scopedChatIds()
    if (chatIds.length === 0)
      return []

    bridge.sendEvent(CoreEventType.StorageSearchMessages, {
      requestId,
      content: params.query,
      useVector: params.useVector,
      pagination: {
        limit: params.limit,
        offset: 0,
      },
      fromUserId: params.fromUserId ?? undefined,
      timeRange: params.timeRange
        ? {
            start: params.timeRange.start ?? undefined,
            end: params.timeRange.end ?? undefined,
          }
        : undefined,
      chatIds,
    })

    const { messages } = await waitForEventWithTimeout(bridge.waitForEvent(
      CoreEventType.StorageSearchMessagesData,
      data => data.requestId === requestId,
    ))

    return messages
  }

  async function retrieveContext(params: RetrieveContextParams) {
    const allowed = resolveWhitelistedSearchChatIds([params.chatId], accountSettings.value)
    if (allowed.length === 0)
      return []

    const requestId = createRequestId()

    bridge.sendEvent(CoreEventType.StorageSearchMessages, {
      requestId,
      chatId: params.chatId,
      content: '',
      useVector: false,
      pagination: {
        limit: params.limit,
        offset: 0,
      },
      timeRange: {
        end: params.targetTimestamp - 1,
      },
    })

    const { messages } = await waitForEventWithTimeout(bridge.waitForEvent(
      CoreEventType.StorageSearchMessagesData,
      data => data.requestId === requestId,
    ))

    return messages
  }

  async function getDialogs(_: GetDialogsParams) {
    bridge.sendEvent(CoreEventType.StorageFetchDialogs)
    const { dialogs } = await waitForEventWithTimeout(bridge.waitForEvent(CoreEventType.StorageDialogs))
    return filterDialogsByWhitelist(dialogs as CoreDialog[], accountSettings.value)
  }

  async function searchPhotos(params: SearchPhotosParams) {
    logger.withFields({ params }).log('searchPhotos executor called')

    const chatIds = scopedChatIds()
    if (chatIds.length === 0)
      return []

    const requestId = createRequestId()

    bridge.sendEvent(CoreEventType.StorageSearchPhotos, {
      requestId,
      content: params.query,
      useVector: params.useVector,
      pagination: {
        limit: params.limit,
        offset: 0,
      },
      chatIds,
    })

    const { photos } = await waitForEventWithTimeout(bridge.waitForEvent(
      CoreEventType.StorageSearchPhotosData,
      data => data.requestId === requestId,
    ))

    logger.withFields({ photosCount: photos.length }).log('searchPhotos received response')
    const allowed = new Set(chatIds)
    return (photos as CoreRetrievalPhoto[]).filter(photo => photo.chatId != null && allowed.has(String(photo.chatId)))
  }

  async function chatNote(params: ChatNoteParams) {
    const allowed = resolveWhitelistedSearchChatIds([params.chatId], accountSettings.value)
    if (allowed.length === 0)
      return ''

    bridge.sendEvent(CoreEventType.StorageChatNote, params)
    const { note } = await waitForEventWithTimeout(bridge.waitForEvent(CoreEventType.StorageChatNoteData))
    return note ?? ''
  }

  return {
    chatNote,
    getDialogs,
    retrieveContext,
    searchMessages,
    searchPhotos,
  }
}
