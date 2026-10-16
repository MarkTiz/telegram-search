import { describe, expect, it } from 'vitest'

import { generateDefaultAccountSettings, normalizeAccountSettings, normalizeMaxMediaSizeMb } from '../account-settings'

describe('normalizeMaxMediaSizeMb', () => {
  it('keeps intentional MB values', () => {
    expect(normalizeMaxMediaSizeMb(0)).toBe(0)
    expect(normalizeMaxMediaSizeMb(10)).toBe(10)
    expect(normalizeMaxMediaSizeMb(2048)).toBe(2048)
  })

  it('converts values mistakenly stored as bytes back to MB', () => {
    expect(normalizeMaxMediaSizeMb(10 * 1024 * 1024)).toBe(10)
    expect(normalizeMaxMediaSizeMb(1 * 1024 * 1024)).toBe(1)
  })

  it('treats nullish or invalid values as unlimited (0)', () => {
    expect(normalizeMaxMediaSizeMb(undefined)).toBe(0)
    expect(normalizeMaxMediaSizeMb(null)).toBe(0)
    expect(normalizeMaxMediaSizeMb(Number.NaN)).toBe(0)
    expect(normalizeMaxMediaSizeMb(-5)).toBe(0)
  })
})

describe('normalizeAccountSettings maxMediaSize', () => {
  it('rewrites byte-form maxMediaSize under messageProcessing.defaults', () => {
    const settings = generateDefaultAccountSettings()
    settings.messageProcessing!.defaults!.maxMediaSize = 10 * 1024 * 1024
    const normalized = normalizeAccountSettings(settings)
    expect(normalized.messageProcessing?.defaults?.maxMediaSize).toBe(10)
  })
})
