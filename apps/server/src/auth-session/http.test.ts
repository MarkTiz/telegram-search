import { generateDefaultConfig } from '@tg-search/common'
import { H3 } from 'h3'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { registerAuthSessionRoutes } from './http'

const listPublicAuthSessions = vi.hoisted(() => vi.fn())
const importAuthSessions = vi.hoisted(() => vi.fn())
const enabled = vi.hoisted(() => ({ value: false }))

vi.mock('./service', () => ({
  isAuthSessionStoreEnabled: () => enabled.value,
  listPublicAuthSessions,
  importAuthSessions,
}))

const SESSION = '1AgAOM-import-session-value'

function app() {
  const api = new H3()
  registerAuthSessionRoutes(api, generateDefaultConfig())
  return api
}

describe('auth session http', () => {
  beforeEach(() => {
    enabled.value = false
    listPublicAuthSessions.mockReset()
    importAuthSessions.mockReset()
  })

  it('reports client authority when the server secret is unset', async () => {
    const response = await app().fetch(new Request('http://localhost/auth/sessions'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ authority: 'client', sessions: [] })
    expect(listPublicAuthSessions).not.toHaveBeenCalled()
  })

  it('returns the public catalog without session material', async () => {
    enabled.value = true
    listPublicAuthSessions.mockResolvedValue([
      { id: 'slot-1', displayName: 'Ada', telegramUserId: '42', connected: true },
    ])

    const response = await app().fetch(new Request('http://localhost/auth/sessions'))
    expect(response.headers.get('cache-control')).toBe('no-store')
    const body = await response.json()
    expect(body).toEqual({
      authority: 'server',
      sessions: [
        { id: 'slot-1', displayName: 'Ada', telegramUserId: '42', connected: true },
      ],
    })
    expect(JSON.stringify(body)).not.toContain('session_ciphertext')
  })

  it('imports local sessions once and does not echo them back', async () => {
    enabled.value = true
    importAuthSessions.mockResolvedValue([
      { id: 'slot-1', displayName: null, telegramUserId: null, connected: false },
    ])

    const response = await app().fetch(new Request('http://localhost/auth/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions: [{ id: 'slot-1', session: SESSION }] }),
    }))

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(JSON.stringify(body)).not.toContain(SESSION)
    expect(importAuthSessions).toHaveBeenCalledWith(generateDefaultConfig(), [
      { id: 'slot-1', session: SESSION },
    ])
  })

  it('rejects a disabled import and an invalid body', async () => {
    const disabled = await app().fetch(new Request('http://localhost/auth/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions: [{ id: 'slot-1', session: SESSION }] }),
    }))
    expect(disabled.status).toBe(409)
    expect(importAuthSessions).not.toHaveBeenCalled()

    enabled.value = true
    const invalid = await app().fetch(new Request('http://localhost/auth/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessions: [{ id: 'bad id', session: SESSION }] }),
    }))
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'Invalid auth session import' })
    expect(importAuthSessions).not.toHaveBeenCalled()
  })
})
