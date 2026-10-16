import type { InferOutput } from 'valibot'

import { array, boolean, object, optional, string } from 'valibot'

/** One chat opened to the public agent API (account-scoped for message ACL). */
export const agentApiEntrySchema = object({
  accountId: string(),
  chatId: string(),
})

/** Global Agent API config (single store, not per-account). */
export const globalAgentApiConfigSchema = object({
  enabled: optional(boolean(), false),
  entries: optional(array(agentApiEntrySchema), []),
})

export type AgentApiEntry = InferOutput<typeof agentApiEntrySchema>
export type GlobalAgentApiConfig = InferOutput<typeof globalAgentApiConfigSchema>

export const AGENT_API_SETTINGS_KEY = 'agentApi'
