import { describe, expect, it } from 'vitest'

import { decryptSession, encryptSession, readSessionSecret } from './cipher'

const SECRET = 'a'.repeat(32)
const SESSION = '1AgAOMTQ5LjE1NC4xNjcuNDEBu3session-material'

describe('telegram auth session cipher', () => {
  it('round-trips a session and does not embed the plaintext', () => {
    const first = encryptSession(SESSION, SECRET)
    const second = encryptSession(SESSION, SECRET)

    expect(first).not.toBe(second)
    expect(first).not.toContain(SESSION)
    expect(decryptSession(first, SECRET)).toBe(SESSION)
    expect(decryptSession(second, SECRET)).toBe(SESSION)
  })

  it('rejects a different secret or a tampered payload', () => {
    const payload = encryptSession(SESSION, SECRET)
    expect(() => decryptSession(payload, `${'b'.repeat(32)}`)).toThrow('Failed to decrypt Telegram session')

    const tampered = `${payload.slice(0, -4)}aaaa`
    expect(() => decryptSession(tampered, SECRET)).toThrow('Failed to decrypt Telegram session')
  })

  it('requires a high-entropy session secret when persistence is configured', () => {
    expect(readSessionSecret({})).toBeUndefined()
    expect(readSessionSecret({ TG_SEARCH_SESSION_SECRET: '   ' })).toBeUndefined()
    expect(readSessionSecret({ TG_SEARCH_SESSION_SECRET: SECRET })).toBe(SECRET)
    expect(() => readSessionSecret({ TG_SEARCH_SESSION_SECRET: 'too-short' })).toThrow(/at least 32/)
    expect(() => readSessionSecret({ TG_SEARCH_SESSION_SECRET: `${SECRET} trailing` })).toThrow(/whitespace/)
  })
})
