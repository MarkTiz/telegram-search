import type { CoreDB } from '../db'
import type { GlobalAgentApiConfig } from '../types/agent-api'
import type { PromiseResult } from '../utils/result'

import { eq } from 'drizzle-orm'
import { safeParse } from 'valibot'

import { appSettingsTable } from '../schemas/app-settings'
import { AGENT_API_SETTINGS_KEY, globalAgentApiConfigSchema } from '../types/agent-api'
import { withResult } from '../utils/result'

function defaultAgentApiConfig(): GlobalAgentApiConfig {
  return { enabled: false, entries: [] }
}

function normalizeAgentApiConfig(raw: unknown): GlobalAgentApiConfig {
  const parsed = safeParse(globalAgentApiConfigSchema, raw ?? {})
  if (!parsed.success)
    return defaultAgentApiConfig()

  const entries = (parsed.output.entries ?? [])
    .map(entry => ({
      accountId: String(entry.accountId),
      chatId: String(entry.chatId),
    }))
    .filter(entry => entry.accountId && entry.chatId)

  // Deduplicate by accountId+chatId
  const seen = new Set<string>()
  const unique: Array<{ accountId: string, chatId: string }> = []
  for (const entry of entries) {
    const key = `${entry.accountId}:${entry.chatId}`
    if (seen.has(key))
      continue
    seen.add(key)
    unique.push(entry)
  }

  return {
    enabled: parsed.output.enabled ?? false,
    entries: unique,
  }
}

async function getJson(db: CoreDB, key: string): PromiseResult<unknown | null> {
  return withResult(async () => {
    const rows = await db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, key))
      .limit(1)
    return rows[0]?.value ?? null
  })
}

async function setJson(db: CoreDB, key: string, value: unknown): PromiseResult<void> {
  return withResult(async () => {
    const now = Date.now()
    await db
      .insert(appSettingsTable)
      .values({
        key,
        value,
        updated_at: now,
      })
      .onConflictDoUpdate({
        target: appSettingsTable.key,
        set: {
          value,
          updated_at: now,
        },
      })
  })
}

async function getAgentApiConfig(db: CoreDB): PromiseResult<GlobalAgentApiConfig> {
  return withResult(async () => {
    const raw = (await getJson(db, AGENT_API_SETTINGS_KEY)).expect('Failed to read agent API settings')
    return normalizeAgentApiConfig(raw)
  })
}

async function setAgentApiConfig(db: CoreDB, config: GlobalAgentApiConfig): PromiseResult<GlobalAgentApiConfig> {
  return withResult(async () => {
    const normalized = normalizeAgentApiConfig(config)
    ;(await setJson(db, AGENT_API_SETTINGS_KEY, normalized)).expect('Failed to write agent API settings')
    return normalized
  })
}

export const appSettingsModels = {
  getJson,
  setJson,
  getAgentApiConfig,
  setAgentApiConfig,
}

export type AppSettingsModels = typeof appSettingsModels
