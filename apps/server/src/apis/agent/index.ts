/**
 * Public unauthenticated agent HTTP API (intranet).
 * Mounted at /agent → clients hit /api/agent/* via nginx.
 *
 * Allowlist is GLOBAL (app_settings key agentApi), not per-account settings.
 */

import type { CoreDB, EmbeddingDimension, Models } from '@tg-search/core'

import { useLogger } from '@guiiai/logg'
import {
  convertToCoreRetrievalMessages,
  embedContents,
  normalizeAccountSettings,
} from '@tg-search/core'
import { assertBodySize, defineEventHandler, H3, readBody } from 'h3'
import {
  array,
  boolean,
  maxValue,
  minValue,
  number,
  object,
  optional,
  parse,
  pipe,
  string,
} from 'valibot'

import {
  chatIdsForAccount,
  collectAllowedChatIdSet,
  findEntryForChat,
  intersectAgentChatIds,
  migrateLegacyAgentApiIfNeeded,
  resolveAgentScopes,
} from './scope'

const JSON_HEADERS = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS })
}

function disabledResponse(): Response {
  return json({
    ok: false,
    error: {
      code: 'AGENT_API_DISABLED',
      message: 'Agent API is disabled. Enable it in AI Chat → 大模型配置.',
    },
  }, 403)
}

const accountIdsSchema = optional(array(string()))

const searchMessagesBodySchema = object({
  query: string(),
  useVector: optional(boolean(), true),
  limit: optional(pipe(number(), minValue(1), maxValue(50)), 10),
  fromUserId: optional(string()),
  timeRange: optional(object({
    start: optional(number()),
    end: optional(number()),
  })),
  chatIds: optional(array(string())),
  accountIds: accountIdsSchema,
})

const retrieveContextBodySchema = object({
  chatId: string(),
  targetTimestamp: number(),
  limit: optional(pipe(number(), minValue(1), maxValue(50)), 5),
  accountId: optional(string()),
  accountIds: accountIdsSchema,
})

const getDialogsBodySchema = object({
  accountIds: accountIdsSchema,
})

const searchPhotosBodySchema = object({
  query: string(),
  useVector: optional(boolean(), true),
  limit: optional(pipe(number(), minValue(1), maxValue(50)), 10),
  chatIds: optional(array(string())),
  accountIds: accountIdsSchema,
})

const chatNoteBodySchema = object({
  chatId: string(),
  note: optional(string(), ''),
  modify: optional(boolean(), false),
  accountId: optional(string()),
  accountIds: accountIdsSchema,
})

const configPutBodySchema = object({
  enabled: boolean(),
  /** Global allowlist entries (cross-account). */
  entries: optional(array(object({
    accountId: string(),
    chatId: string(),
  })), []),
  /**
   * Backward-compatible UI payload: per-account chatIds are flattened into entries.
   * Prefer `entries` when both are sent.
   */
  accounts: optional(array(object({
    accountId: string(),
    chatIds: array(string()),
  })), []),
})

async function readJsonBody<T>(event: Parameters<typeof readBody>[0], schema: Parameters<typeof parse>[0]): Promise<T> {
  assertBodySize(event, 65_536)
  const raw = await readBody(event)
  return parse(schema, raw ?? {}) as T
}

function pruneEntriesToSyncWhitelist(
  entries: Array<{ accountId: string, chatId: string }>,
  whitelistByAccount: Map<string, Set<string>>,
): Array<{ accountId: string, chatId: string }> {
  return entries.filter((entry) => {
    const whitelist = whitelistByAccount.get(entry.accountId)
    return whitelist != null && whitelist.has(String(entry.chatId))
  })
}

export function agentApi(db: CoreDB, models: Models): H3 {
  const app = new H3()
  const logger = useLogger('agent-api')

  /** Config is always reachable so the UI can enable the API. */
  app.get('/config', defineEventHandler(async () => {
    try {
      // Promote legacy per-account agentApi once if global store is empty.
      const globalConfig = await migrateLegacyAgentApiIfNeeded(db, models)

      const rows = (await models.accountSettingsModels.listAllAccountsWithSettings(db))
        .expect('Failed to list accounts')
      const sessions = (await models.telegramAuthSessionModels.listStoredSessions(db))
        .expect('Failed to list auth sessions')

      const displayByAccount = new Map<string, string>()
      for (const session of sessions) {
        if (session.account_id && session.display_name)
          displayByAccount.set(session.account_id, session.display_name)
      }

      const selectedByAccount = new Map<string, Set<string>>()
      for (const entry of globalConfig.entries) {
        const set = selectedByAccount.get(entry.accountId) ?? new Set<string>()
        set.add(String(entry.chatId))
        selectedByAccount.set(entry.accountId, set)
      }

      const accounts = await Promise.all(rows.map(async (row) => {
        const syncWhitelist = (row.settings.messageProcessing?.whitelistChatIds ?? []).map(String)
        const agentChatIds = [...(selectedByAccount.get(row.id) ?? [])]
        const chatsRows = (await models.chatModels.fetchChatsByAccountId(db, row.id)).orUndefined() ?? []
        const chats = chatsRows
          .filter(chat => syncWhitelist.includes(String(chat.chat_id)))
          .map(chat => ({
            chatId: String(chat.chat_id),
            name: chat.chat_name ?? String(chat.chat_id),
            type: chat.chat_type,
          }))

        return {
          accountId: row.id,
          platform: row.platform,
          platformUserId: row.platformUserId,
          displayName: displayByAccount.get(row.id)
            ?? (row.platformUserId ? `telegram:${row.platformUserId}` : row.id.slice(0, 8)),
          syncWhitelistChatIds: syncWhitelist,
          agentApiChatIds: agentChatIds,
          chats,
        }
      }))

      return json({
        enabled: globalConfig.enabled === true,
        entries: globalConfig.entries,
        accounts,
      })
    }
    catch (error) {
      logger.withError(error).error('Failed to get agent API config')
      return json({ ok: false, error: { code: 'INTERNAL', message: 'Failed to load config' } }, 500)
    }
  }))

  app.put('/config', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{
        enabled: boolean
        entries?: Array<{ accountId: string, chatId: string }>
        accounts?: Array<{ accountId: string, chatIds: string[] }>
      }>(event, configPutBodySchema)

      const rows = (await models.accountSettingsModels.listAllAccountsWithSettings(db))
        .expect('Failed to list accounts')

      const whitelistByAccount = new Map<string, Set<string>>()
      for (const row of rows) {
        whitelistByAccount.set(
          row.id,
          new Set((row.settings.messageProcessing?.whitelistChatIds ?? []).map(String)),
        )
      }

      let entries: Array<{ accountId: string, chatId: string }>
      if (body.entries && body.entries.length > 0) {
        entries = body.entries.map(e => ({ accountId: String(e.accountId), chatId: String(e.chatId) }))
      }
      else if (body.accounts) {
        entries = []
        for (const account of body.accounts) {
          for (const chatId of account.chatIds) {
            entries.push({ accountId: String(account.accountId), chatId: String(chatId) })
          }
        }
      }
      else {
        entries = []
      }

      const pruned = pruneEntriesToSyncWhitelist(entries, whitelistByAccount)
      const saved = (await models.appSettingsModels.setAgentApiConfig(db, {
        enabled: body.enabled,
        entries: pruned,
      })).expect('Failed to save global agent API config')

      // Clear divergent per-account agentApi leftovers so UI/WS settings cannot resurrect them.
      for (const row of rows) {
        const fresh = (await models.accountSettingsModels.fetchSettingsByAccountId(db, row.id))
          .expect('Failed to fetch account settings')
        if (!fresh.agentApi?.enabled && (fresh.agentApi?.chatIds?.length ?? 0) === 0)
          continue
        await models.accountSettingsModels.updateAccountSettings(db, row.id, normalizeAccountSettings({
          ...fresh,
          agentApi: { enabled: false, chatIds: [] },
        }))
      }

      logger.withFields({
        enabled: saved.enabled,
        entryCount: saved.entries.length,
      }).log('Global agent API config saved')

      return json({
        ok: true,
        enabled: saved.enabled,
        entries: saved.entries,
      })
    }
    catch (error) {
      logger.withError(error).error('Failed to update agent API config')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid config body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'Failed to save config' } }, 500)
    }
  }))

  app.post('/searchMessages', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{
        query: string
        useVector: boolean
        limit: number
        fromUserId?: string
        timeRange?: { start?: number, end?: number }
        chatIds?: string[]
        accountIds?: string[]
      }>(event, searchMessagesBodySchema)

      const { enabled, entries } = await resolveAgentScopes(db, models, body.accountIds)
      if (!enabled)
        return disabledResponse()

      if (!body.query.trim() || entries.length === 0)
        return json({ ok: true, resultsCount: 0, messages: [] })

      const allMessages: ReturnType<typeof convertToCoreRetrievalMessages> = []
      const accountIds = [...new Set(entries.map(e => e.accountId))]

      for (const accountId of accountIds) {
        const allowlist = chatIdsForAccount(entries, accountId)
        const chatIds = intersectAgentChatIds(allowlist, body.chatIds)
        if (chatIds.length === 0)
          continue

        const settings = (await models.accountSettingsModels.fetchSettingsByAccountId(db, accountId))
          .expect('Failed to fetch account settings')
        const embeddingSettings = settings.embedding
        const embeddingDimension = embeddingSettings.dimension as EmbeddingDimension
        const filters = {
          fromUserId: body.fromUserId,
          timeRange: body.timeRange,
          chatIds,
        }

        let embedding: number[] | undefined
        if (body.useVector) {
          const embeddingResult = (await embedContents([body.query], embeddingSettings)).orUndefined()
          if (embeddingResult)
            embedding = embeddingResult.embeddings[0]
        }

        const rows = (await models.chatMessageModels.retrieveMessages(
          db,
          logger,
          accountId,
          embeddingDimension,
          body.useVector && embedding
            ? { embedding, model: embeddingSettings.model, text: body.query }
            : { model: embeddingSettings.model, text: body.query },
          { limit: body.limit, offset: 0 },
          filters,
        )).expect('Failed to search messages')

        const converted = convertToCoreRetrievalMessages(rows).map(msg => ({
          ...msg,
          accountId,
        }))
        allMessages.push(...converted)
      }

      allMessages.sort((a, b) => {
        const sa = a.similarity ?? 0
        const sb = b.similarity ?? 0
        if (sb !== sa)
          return sb - sa
        return (b.platformTimestamp ?? 0) - (a.platformTimestamp ?? 0)
      })

      const trimmed = allMessages.slice(0, body.limit)
      return json({ ok: true, resultsCount: trimmed.length, messages: trimmed })
    }
    catch (error) {
      logger.withError(error).error('searchMessages failed')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid request body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'searchMessages failed' } }, 500)
    }
  }))

  app.post('/retrieveContext', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{
        chatId: string
        targetTimestamp: number
        limit: number
        accountId?: string
        accountIds?: string[]
      }>(event, retrieveContextBodySchema)

      const { enabled, entries } = await resolveAgentScopes(db, models, body.accountIds)
      if (!enabled)
        return disabledResponse()

      const entry = findEntryForChat(entries, body.chatId, body.accountId)
      if (!entry)
        return json({ ok: true, contextCount: 0, messages: [] })

      const rows = (await models.chatMessageModels.fetchMessagesByTimeRange(
        db,
        entry.accountId,
        { start: 0, end: body.targetTimestamp - 1 },
        [String(body.chatId)],
        { limit: body.limit, offset: 0 },
        undefined,
        'desc',
      )).expect('Failed to retrieve context')

      const messages = convertToCoreRetrievalMessages(rows as never).map(msg => ({
        ...msg,
        accountId: entry.accountId,
      }))

      return json({ ok: true, contextCount: messages.length, messages })
    }
    catch (error) {
      logger.withError(error).error('retrieveContext failed')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid request body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'retrieveContext failed' } }, 500)
    }
  }))

  app.post('/getDialogs', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{ accountIds?: string[] }>(event, getDialogsBodySchema)

      const { enabled, entries } = await resolveAgentScopes(db, models, body.accountIds)
      if (!enabled)
        return disabledResponse()

      if (entries.length === 0)
        return json({ ok: true, dialogsCount: 0, dialogs: [] })

      const dialogs: Array<{
        accountId: string
        chatId: string
        name: string
        type: string
        username?: string
        note?: string
      }> = []

      const byAccount = new Map<string, Set<string>>()
      for (const entry of entries) {
        const set = byAccount.get(entry.accountId) ?? new Set<string>()
        set.add(entry.chatId)
        byAccount.set(entry.accountId, set)
      }

      for (const [accountId, allowed] of byAccount) {
        const chats = (await models.chatModels.fetchChatsByAccountId(db, accountId))
          .expect('Failed to fetch chats')
        for (const chat of chats) {
          const chatId = String(chat.chat_id)
          if (!allowed.has(chatId))
            continue
          dialogs.push({
            accountId,
            chatId,
            name: chat.chat_name ?? chatId,
            type: String(chat.chat_type),
            username: chat.chat_username ?? undefined,
            note: chat.note ?? undefined,
          })
        }
      }

      return json({ ok: true, dialogsCount: dialogs.length, dialogs })
    }
    catch (error) {
      logger.withError(error).error('getDialogs failed')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid request body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'getDialogs failed' } }, 500)
    }
  }))

  app.post('/searchPhotos', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{
        query: string
        useVector: boolean
        limit: number
        chatIds?: string[]
        accountIds?: string[]
      }>(event, searchPhotosBodySchema)

      const { enabled, entries } = await resolveAgentScopes(db, models, body.accountIds)
      if (!enabled)
        return disabledResponse()

      const allowedChatIds = collectAllowedChatIdSet(entries)
      if (body.chatIds?.length) {
        const requested = new Set(body.chatIds.map(String))
        for (const id of [...allowedChatIds]) {
          if (!requested.has(id))
            allowedChatIds.delete(id)
        }
      }

      if (allowedChatIds.size === 0 || !body.query.trim())
        return json({ ok: true, resultsCount: 0, photos: [] })

      const accountId = entries[0]?.accountId
      if (!accountId)
        return json({ ok: true, resultsCount: 0, photos: [] })

      const settings = (await models.accountSettingsModels.fetchSettingsByAccountId(db, accountId))
        .expect('Failed to fetch account settings')
      const embeddingSettings = settings.embedding
      const embeddingDimension = embeddingSettings.dimension as EmbeddingDimension
      const overfetch = Math.min(body.limit * 5, 100)

      type PhotoRow = {
        id: string
        message_id: string | null
        platform_message_id?: string
        chat_id?: string
        chat_name?: string
        chat_type?: string
        description: string | null
        image_mime_type: string | null
        created_at: number
        similarity?: number
      }

      let rows: PhotoRow[] = []
      if (body.useVector) {
        const embeddingResult = (await embedContents([body.query], embeddingSettings)).orUndefined()
        if (!embeddingResult)
          return json({ ok: true, resultsCount: 0, photos: [] })
        rows = (await models.photoModels.searchPhotosByVector(
          db,
          embeddingResult.embeddings[0],
          embeddingDimension,
          overfetch,
        )).expect('Failed to search photos by vector') as PhotoRow[]
      }
      else {
        rows = (await models.photoModels.searchPhotosByText(
          db,
          body.query,
          overfetch,
        )).expect('Failed to search photos by text') as PhotoRow[]
      }

      const photos = rows
        .filter(photo => photo.chat_id != null && allowedChatIds.has(String(photo.chat_id)))
        .slice(0, body.limit)
        .map(photo => ({
          id: photo.id,
          messageId: photo.message_id,
          platformMessageId: photo.platform_message_id,
          chatId: photo.chat_id,
          chatName: photo.chat_name,
          chatType: photo.chat_type,
          description: photo.description,
          mimeType: photo.image_mime_type,
          createdAt: photo.created_at,
          similarity: photo.similarity,
        }))

      return json({ ok: true, resultsCount: photos.length, photos })
    }
    catch (error) {
      logger.withError(error).error('searchPhotos failed')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid request body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'searchPhotos failed' } }, 500)
    }
  }))

  app.post('/chatNote', defineEventHandler(async (event) => {
    try {
      const body = await readJsonBody<{
        chatId: string
        note: string
        modify: boolean
        accountId?: string
        accountIds?: string[]
      }>(event, chatNoteBodySchema)

      const { enabled, entries } = await resolveAgentScopes(db, models, body.accountIds)
      if (!enabled)
        return disabledResponse()

      const entry = findEntryForChat(entries, body.chatId, body.accountId)
      if (!entry)
        return json({ ok: true, chatId: body.chatId, note: '' })

      const note = await models.chatModels.getOrModifyChatNote(
        db,
        entry.accountId,
        String(body.chatId),
        body.note ?? '',
        body.modify,
      )

      return json({
        ok: true,
        accountId: entry.accountId,
        chatId: body.chatId,
        note: note ?? '',
      })
    }
    catch (error) {
      logger.withError(error).error('chatNote failed')
      if (error && typeof error === 'object' && 'issues' in (error as object))
        return json({ ok: false, error: { code: 'INVALID_ARGUMENT', message: 'Invalid request body' } }, 400)
      return json({ ok: false, error: { code: 'INTERNAL', message: 'chatNote failed' } }, 500)
    }
  }))

  return app
}
