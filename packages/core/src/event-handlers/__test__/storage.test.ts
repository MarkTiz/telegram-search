import type { Models } from '../../models'
import type { CoreDialog } from '../../types/dialog'

import { useLogger } from '@guiiai/logg'
import { Ok } from '@unbird/result'
import { describe, expect, it, vi } from 'vitest'

import { getMockEmptyDB } from '../../../mock'
import { createCoreContext } from '../../context'
import { CoreEventType } from '../../types/events'
import { registerStorageEventHandlers } from '../storage'

const logger = useLogger()
const lastMessageDate = new Date()

const fetchChatsByAccountId = vi.fn(async (_db: unknown, _accountId: string) => {
  const rows = [
    {
      id: 'joined-chat-1',
      platform: 'telegram',
      chat_id: '1001',
      chat_name: 'Test Chat',
      chat_type: 'user',
      dialog_date: lastMessageDate.getTime(),
      created_at: Date.now(),
      updated_at: Date.now(),
    },
  ]
  return Ok(rows)
})

const getChatMessagesStats = vi.fn(async (_db: unknown, _accountId: string) => {
  const stats = [
    {
      chat_id: '1001',
      message_count: 42,
    },
  ]
  return Ok(stats)
})

const recordChats = vi.fn(async (_db: unknown, _dialogs: CoreDialog[], _accountId?: string) => {
  // Simulate Result-like object used by production code
  return {
    expect<T>(_message: string): T[] {
      // For this test we don't need to assert on returned value
      return [] as unknown as T[]
    },
  }
})

const clearSyncPtsOutsideWhitelist = vi.fn(async () => 0)

// Message-related mocks
const isChatAccessibleByAccount = vi.fn(async (_db: unknown, _accountId: string, _chatId: string) => Ok(true))
const retrieveMessages = vi.fn(async (_db: unknown, _accountId: string, _dimension: unknown, _content: unknown, _pagination: unknown, _filters: unknown) => Ok([] as unknown[]))

const ensureLastSeenBaselines = vi.fn(async () => Ok(0))
const getLocalUnreadCounts = vi.fn(async () => Ok([] as Array<{ chat_id: string, unread_count: number }>))

const models = {
  chatModels: {
    fetchChatsByAccountId,
    getChatMessagesStats,
    recordChats,
    clearSyncPtsOutsideWhitelist,
    isChatAccessibleByAccount,
    retrieveMessages,
    ensureLastSeenBaselines,
  },
  chatMessageStatsModels: {
    getChatMessagesStats,
    getLocalUnreadCounts,
  },
  accountSettingsModels: {
    fetchSettingsByAccountId: vi.fn(async () => Ok({
      messageProcessing: { whitelistChatIds: [] },
    })),
  },
} as unknown as Models

describe('storage event handlers - dialogs with accounts', () => {
  it('storage:fetch:dialogs should query dialogs for given account and emit mapped dialogs', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    registerStorageEventHandlers(ctx, logger, models)

    const ACCOUNT_ID = 'account-xyz'

    const dialogsPromise = new Promise<CoreDialog[]>((resolve) => {
      ctx.emitter.on(CoreEventType.StorageDialogs, ({ dialogs }) => {
        resolve(dialogs)
      })
    })

    ctx.emitter.emit(CoreEventType.StorageFetchDialogs, { accountId: ACCOUNT_ID })

    const dialogs = await dialogsPromise

    // Verify models were called with correct account id (first arg is db instance)
    expect(fetchChatsByAccountId).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID)
    expect(getChatMessagesStats).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID)

    // Verify mapping to CoreDialog shape
    expect(dialogs).toEqual([
      {
        id: 1001,
        name: 'Test Chat',
        isContact: undefined,
        folderIds: [],
        type: 'user',
        messageCount: 42,
        pinned: false,
        accessHash: undefined,
        lastMessageDate,
        unreadCount: 0,
      },
    ])
  })

  it('storage:record:dialogs should call recordChats with dialogs and accountId', async () => {
    recordChats.mockClear()
    clearSyncPtsOutsideWhitelist.mockClear()
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    ctx.setCurrentAccountId('account-abc')
    registerStorageEventHandlers(ctx, logger, models)

    const ACCOUNT_ID = 'account-abc'
    const dialogs: CoreDialog[] = [
      {
        id: 2001,
        name: 'Another Chat',
        type: 'group',
        messageCount: 0,
        pts: 42,
      },
    ]

    ctx.emitter.emit(CoreEventType.StorageRecordDialogs, { dialogs, accountId: ACCOUNT_ID })
    await vi.waitFor(() => expect(clearSyncPtsOutsideWhitelist).toHaveBeenCalled())

    expect(recordChats).toHaveBeenCalledTimes(1)
    // Empty whitelist forces pts=0 so catch-up never targets non-enabled chats.
    expect(recordChats).toHaveBeenCalledWith(
      expect.anything(),
      [{ ...dialogs[0], pts: 0 }],
      ACCOUNT_ID,
    )
    expect(clearSyncPtsOutsideWhitelist).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, [])
  })

  it('storage:record:dialogs keeps pts for whitelisted chats', async () => {
    recordChats.mockClear()
    clearSyncPtsOutsideWhitelist.mockClear()
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    ctx.setCurrentAccountId('account-wl')
    ctx.getAccountSettings = async () => ({
      messageProcessing: { whitelistChatIds: ['2001'] },
    }) as unknown as typeof ctx.getAccountSettings
    registerStorageEventHandlers(ctx, logger, models)

    const ACCOUNT_ID = 'account-wl'
    const dialogs: CoreDialog[] = [
      {
        id: 2001,
        name: 'Whitelisted Chat',
        type: 'channel',
        messageCount: 0,
        pts: 99,
      },
    ]

    ctx.emitter.emit(CoreEventType.StorageRecordDialogs, { dialogs, accountId: ACCOUNT_ID })
    await vi.waitFor(() => expect(clearSyncPtsOutsideWhitelist).toHaveBeenCalled())

    expect(recordChats).toHaveBeenCalledWith(expect.anything(), dialogs, ACCOUNT_ID)
    expect(clearSyncPtsOutsideWhitelist).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, ['2001'])
  })
})

describe('storage event handlers - message access control', () => {
  it('storage:search:messages should reject when account has no access to specified chatId', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    registerStorageEventHandlers(ctx, logger, models)

    const ACCOUNT_ID = 'account-no-access'
    const CHAT_ID = '2002'

    ctx.setCurrentAccountId(ACCOUNT_ID)

    // For this test, deny access for this chat
    ;(isChatAccessibleByAccount as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(Ok(false))

    const errorPromise = new Promise<string>((resolve) => {
      ctx.emitter.on(CoreEventType.CoreError, ({ error }) => {
        resolve(error)
      })
    })

    const dataPromise = new Promise<{ messages: unknown[], requestId?: string }>((resolve) => {
      ctx.emitter.on(CoreEventType.StorageSearchMessagesData, (data) => {
        resolve(data)
      })
    })

    ctx.emitter.emit(CoreEventType.StorageSearchMessages, {
      requestId: 'req-unauth',
      chatId: CHAT_ID,
      content: 'test search',
      useVector: false,
      pagination: { limit: 20, offset: 0 },
    })

    const [error, data] = await Promise.all([errorPromise, dataPromise])

    expect(error).toBe('Unauthorized chat access')
    expect(data).toEqual({ messages: [], hasMore: false, requestId: 'req-unauth' })
    expect(isChatAccessibleByAccount).toHaveBeenCalledWith(expect.anything(), ACCOUNT_ID, CHAT_ID)
    expect(retrieveMessages).not.toHaveBeenCalled()
  })

  it('storage:search:messages should emit empty data when content is empty without filters', async () => {
    const ctx = createCoreContext(getMockEmptyDB, models, logger)
    registerStorageEventHandlers(ctx, logger, models)
    ctx.setCurrentAccountId('account-empty')

    const dataPromise = new Promise<{ messages: unknown[], hasMore: boolean, requestId?: string }>((resolve) => {
      ctx.emitter.on(CoreEventType.StorageSearchMessagesData, (data) => {
        resolve(data)
      })
    })

    ctx.emitter.emit(CoreEventType.StorageSearchMessages, {
      requestId: 'req-empty',
      content: '',
      useVector: false,
      pagination: { limit: 5, offset: 0 },
    })

    await expect(dataPromise).resolves.toEqual({ messages: [], hasMore: false, requestId: 'req-empty' })
    expect(retrieveMessages).not.toHaveBeenCalled()
  })
})
