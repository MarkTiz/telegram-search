import { describe, expect, it } from 'vitest'

import { mockDB } from '../../db/mock'
import { accountsTable } from '../../schemas/accounts'
import { telegramAuthSessionsTable } from '../../schemas/telegram-auth-sessions'
import { accountModels } from '../accounts'
import { telegramAuthSessionModels } from '../telegram-auth-sessions'

async function setupDb() {
  return mockDB({
    accountsTable,
    telegramAuthSessionsTable,
  })
}

describe('models/telegram-auth-sessions', () => {
  it('stores ciphertext and keeps it out of the public catalog', async () => {
    const db = await setupDb()
    const ciphertext = 'enc-v1-not-a-session'

    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-1', ciphertext)).expect('upsert')

    const stored = (await telegramAuthSessionModels.listStoredSessions(db)).expect('stored')
    expect(stored).toHaveLength(1)
    expect(stored[0]?.session_ciphertext).toBe(ciphertext)

    const catalog = (await telegramAuthSessionModels.listPublicSessions(db)).expect('public')
    expect(catalog).toEqual([
      { id: 'slot-1', display_name: null, telegram_user_id: null },
    ])
    expect(JSON.stringify(catalog)).not.toContain(ciphertext)
  })

  it('allows several sessions before a Telegram account id is known', async () => {
    const db = await setupDb()

    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-1', 'cipher-1')).expect('upsert 1')
    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-2', 'cipher-2')).expect('upsert 2')

    const stored = (await telegramAuthSessionModels.listStoredSessions(db)).expect('stored')
    expect(stored.map(row => row.id)).toEqual(['slot-1', 'slot-2'])
    expect(stored.every(row => row.account_id === null)).toBe(true)
  })

  it('keeps one session row per Telegram account id', async () => {
    const db = await setupDb()
    const account = await accountModels.recordAccount(db, 'telegram', 'user-1')

    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-1', 'cipher-1')).expect('upsert 1')
    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-2', 'cipher-2')).expect('upsert 2')
    ;(await telegramAuthSessionModels.linkAccount(db, 'slot-1', account.id)).expect('link 1')
    ;(await telegramAuthSessionModels.linkAccount(db, 'slot-2', account.id)).expect('link 2')

    const stored = (await telegramAuthSessionModels.listStoredSessions(db)).expect('stored')
    const owners = stored.filter(row => row.account_id === account.id)
    expect(owners.map(row => row.id)).toEqual(['slot-2'])
  })

  it('updates display profile, replaces ciphertext, and deletes a slot', async () => {
    const db = await setupDb()

    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-1', 'cipher-1')).expect('upsert')
    ;(await telegramAuthSessionModels.updateProfile(db, 'slot-1', {
      telegramUserId: '42',
      displayName: 'Ada',
    })).expect('profile')
    ;(await telegramAuthSessionModels.upsertCiphertext(db, 'slot-1', 'cipher-2')).expect('rotate')

    const [row] = (await telegramAuthSessionModels.listStoredSessions(db)).expect('stored')
    expect(row).toMatchObject({
      id: 'slot-1',
      session_ciphertext: 'cipher-2',
      telegram_user_id: '42',
      display_name: 'Ada',
    })

    ;(await telegramAuthSessionModels.deleteSession(db, 'slot-1')).expect('delete')
    const remaining = (await telegramAuthSessionModels.listStoredSessions(db)).expect('remaining')
    expect(remaining).toEqual([])
  })
})
