import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSessionStore } from '../useSession'

const SESSION_KEY = 'v2/websocket/sessions'

describe('server auth session authority', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('replaces local StringSessions with the server catalog', async () => {
    // Server mode used to treat this localStorage entry as the GramJS session.
    const store = useSessionStore()
    store.init()
    store.updateSession(store.activeSessionId!, { session: 'local-session-secret' })

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).not.toBe('POST')
      return new Response(JSON.stringify({
        authority: 'server',
        sessions: [{ id: 'server-slot', displayName: 'Ada', telegramUserId: '42' }],
      }))
    }))

    await store.prepareServerSessions()

    expect(store.serverAuthority).toBe(true)
    expect(store.transportReady).toBe(true)
    expect(store.activeSessionId).toBe('server-slot')
    expect(store.activeSession?.session).toBeUndefined()
    expect(store.activeSession?.me).toMatchObject({ id: '42', name: 'Ada', type: 'user' })
    expect(localStorage.getItem(SESSION_KEY)).not.toContain('local-session-secret')
  })

  it('imports local sessions once when the server store is empty, then drops the strings', async () => {
    const store = useSessionStore()
    store.init()
    const localId = store.activeSessionId!
    store.updateSession(localId, { session: 'local-session-secret' })

    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { sessions: { id: string, session: string }[] }
        expect(body.sessions).toEqual([{ id: localId, session: 'local-session-secret' }])
        return new Response(JSON.stringify({
          authority: 'server',
          sessions: [{ id: localId, displayName: null, telegramUserId: null }],
        }))
      }
      return new Response(JSON.stringify({ authority: 'server', sessions: [] }))
    }))

    await store.prepareServerSessions()

    expect(store.activeSessionId).toBe(localId)
    expect(store.activeSession?.session).toBeUndefined()
    expect(localStorage.getItem(SESSION_KEY)).not.toContain('local-session-secret')
    expect(store.applySessionUpdate('should-not-stick')).toBeUndefined()
    expect(store.activeSession?.session).toBeUndefined()
  })

  it('keeps the local session when the server is still the client authority', async () => {
    const store = useSessionStore()
    store.init()
    store.updateSession(store.activeSessionId!, { session: 'local-session-secret' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      authority: 'client',
      sessions: [],
    }))))

    await store.prepareServerSessions()

    expect(store.serverAuthority).toBe(false)
    expect(store.activeSession?.session).toBe('local-session-secret')
  })
})
