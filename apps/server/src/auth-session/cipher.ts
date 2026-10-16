import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const VERSION = 'v1'
const KEY_SALT = 'tg-search-auth-session-v1'
const MIN_SECRET_LENGTH = 32

export function readSessionSecret(env: Record<string, string | undefined>): string | undefined {
  const value = env.TG_SEARCH_SESSION_SECRET?.trim()
  if (!value)
    return undefined
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(`TG_SEARCH_SESSION_SECRET must contain at least ${MIN_SECRET_LENGTH} characters`)
  }
  if (/\s/.test(value)) {
    throw new Error('TG_SEARCH_SESSION_SECRET must not contain whitespace')
  }
  return value
}

function deriveKey(secret: string): Buffer {
  return scryptSync(secret, KEY_SALT, 32)
}

export function encryptSession(plaintext: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptSession(payload: string, secret: string): string {
  const [version, ivPart, tagPart, ciphertextPart] = payload.split('.')
  if (version !== VERSION || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error('Failed to decrypt Telegram session')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(ivPart, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  }
  catch {
    throw new Error('Failed to decrypt Telegram session')
  }
}
