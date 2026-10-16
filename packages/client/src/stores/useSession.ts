import type { CoreUserEntity } from '@tg-search/core'

import { useLocalStorage } from '@vueuse/core'
import { defineStore } from 'pinia'
import { v4 as uuidv4 } from 'uuid'
import { computed, ref } from 'vue'

import { API_BASE, IS_CORE_MODE } from '../constants'

const CORE_TYPE = 'core-bridge'
const WS_TYPE = 'websocket'

export interface StoredSession {
  uuid: string
  me?: CoreUserEntity
  session?: string
  type?: 'websocket' | 'core-bridge'
}

interface ServerAuthCatalogEntry {
  id: string
  displayName?: string | null
  telegramUserId?: string | null
}

interface ServerAuthCatalog {
  authority?: string
  sessions?: ServerAuthCatalogEntry[]
}

function withoutSession(session: StoredSession): StoredSession {
  const next = { ...session }
  delete next.session
  return next
}

export const useSessionStore = defineStore('session', () => {
  const type = IS_CORE_MODE ? CORE_TYPE : WS_TYPE
  const sessionKey = `v2/${type}/sessions`
  const activeIdKey = `v2/${type}/active-session-id`

  const sessions = useLocalStorage<Record<string, StoredSession>>(sessionKey, {})
  const activeSessionId = useLocalStorage<string | null>(activeIdKey, null)
  const serverAuthority = ref(false)
  const transportReady = ref(false)
  let prepareTask: Promise<boolean> | undefined

  const createSession = (uuid: string): StoredSession => {
    return { uuid, type }
  }

  const ensureSessionInvariants = () => {
    if (typeof sessions.value !== 'object' || sessions.value === null || Array.isArray(sessions.value))
      sessions.value = {}

    const keys = Object.keys(sessions.value)
    if (keys.length === 0) {
      const id = uuidv4()
      sessions.value = { [id]: createSession(id) }
      activeSessionId.value = id
      return
    }

    if (!activeSessionId.value || !sessions.value[activeSessionId.value])
      activeSessionId.value = keys[0]
  }

  const activeSession = computed({
    get: () => {
      if (!activeSessionId.value)
        return undefined
      return sessions.value[activeSessionId.value]
    },
    set: (val) => {
      if (!val || !activeSessionId.value)
        return
      sessions.value = {
        ...sessions.value,
        [activeSessionId.value]: serverAuthority.value ? withoutSession(val) : val,
      }
    },
  })

  const addNewAccount = () => {
    const newId = uuidv4()
    sessions.value = {
      ...sessions.value,
      [newId]: createSession(newId),
    }
    activeSessionId.value = newId
    return newId
  }

  const removeCurrentAccount = () => {
    const id = activeSessionId.value
    if (!id || !sessions.value[id])
      return false

    const newSessions = { ...sessions.value }
    delete newSessions[id]
    sessions.value = newSessions

    const keys = Object.keys(newSessions)
    if (keys.length === 0) {
      activeSessionId.value = null
    }
    else {
      activeSessionId.value = keys[0]
    }
    return true
  }

  const switchAccount = (sessionId: string) => {
    if (sessions.value[sessionId]) {
      activeSessionId.value = sessionId
    }
  }

  const updateSession = (sessionId: string, data: Partial<StoredSession>) => {
    if (sessions.value[sessionId]) {
      const merged = {
        ...sessions.value[sessionId],
        ...data,
      }
      sessions.value = {
        ...sessions.value,
        [sessionId]: serverAuthority.value ? withoutSession(merged) : merged,
      }
    }
  }

  const clearSessionMaterial = () => {
    const next: Record<string, StoredSession> = {}
    for (const [id, session] of Object.entries(sessions.value))
      next[id] = withoutSession(session)
    sessions.value = next
  }

  const enableServerAuthority = () => {
    serverAuthority.value = true
  }

  const applySessionUpdate = (sessionString?: string) => {
    if (serverAuthority.value) {
      clearSessionMaterial()
      return
    }
    if (!sessionString)
      return
    updateSession(activeSessionId.value ?? '', { session: sessionString })
  }

  async function readCatalog(init?: RequestInit): Promise<ServerAuthCatalog | undefined> {
    const response = await fetch(`${API_BASE}/v1/auth/sessions`, { cache: 'no-store', ...init })
    if (!response.ok)
      return undefined
    return await response.json() as ServerAuthCatalog
  }

  async function adoptServerCatalog(): Promise<boolean> {
    ensureSessionInvariants()
    let body: ServerAuthCatalog | undefined
    try {
      body = await readCatalog()
    }
    catch {
      return false
    }
    if (!body)
      return false
    if (body.authority !== 'server' || !Array.isArray(body.sessions))
      return true

    serverAuthority.value = true
    let catalog = body.sessions
    const localImports = Object.values(sessions.value)
      .filter(session => session.session)
      .map(session => ({ id: session.uuid, session: session.session! }))

    // NOTICE: Upload browser StringSessions only when the server store is empty.
    // Importing a second copy of the same GramJS session can invalidate the connection
    // that was just restored. Later browsers should use the catalog instead.
    if (catalog.length === 0 && localImports.length > 0) {
      try {
        const imported = await readCatalog({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessions: localImports }),
        })
        if (imported?.sessions)
          catalog = imported.sessions
      }
      catch {
        // Keep the local strings so the websocket login can still upload them once.
      }
    }

    if (catalog.length === 0)
      return true

    const previousActive = activeSessionId.value
    const previous = sessions.value
    const next: Record<string, StoredSession> = {}
    for (const entry of catalog) {
      const existing = previous[entry.id]
      next[entry.id] = {
        uuid: entry.id,
        type,
        me: entry.telegramUserId
          ? {
              id: entry.telegramUserId,
              name: entry.displayName ?? existing?.me?.name ?? '',
              type: 'user',
              username: existing?.me?.username ?? '',
            }
          : existing?.me,
      }
    }
    sessions.value = next
    activeSessionId.value = previousActive && next[previousActive]
      ? previousActive
      : Object.keys(next)[0] ?? null
    return true
  }

  // Server catalog rows with telegramUserId become me.id; local mode keeps StringSession.
  // Used by the router so returning users skip /login before websocket AccountReady.
  const hasActivePersistedAuth = computed(() => {
    const active = activeSession.value
    if (!active)
      return false
    if (serverAuthority.value)
      return !!active.me?.id
    return !!active.session
  })

  const markTransportReady = () => {
    transportReady.value = true
  }

  const prepareServerSessions = async () => {
    try {
      if (IS_CORE_MODE)
        return
      if (!prepareTask)
        prepareTask = adoptServerCatalog()
      const ready = await prepareTask
      if (!ready)
        prepareTask = undefined
    }
    finally {
      markTransportReady()
    }
  }

  const cleanup = () => {
    sessions.value = {}
    activeSessionId.value = null
  }

  const init = () => {
    ensureSessionInvariants()
  }

  return {
    init,
    sessions,
    activeSessionId,
    activeSession,
    ensureSessionInvariants,
    addNewAccount,
    removeCurrentAccount,
    switchAccount,
    updateSession,
    cleanup,
    serverAuthority,
    transportReady,
    hasActivePersistedAuth,
    prepareServerSessions,
    markTransportReady,
    enableServerAuthority,
    applySessionUpdate,
    clearSessionMaterial,
  }
})
