import type { ClientRegisterEventHandler } from '.'

import { useLogger } from '@guiiai/logg'
import { CoreEventType } from '@tg-search/core'

import { useAccountStore } from '../stores/useAccount'
import { useSessionStore } from '../stores/useSession'

export function registerBasicEventHandlers(
  registerEventHandler: ClientRegisterEventHandler,
) {
  const logger = useLogger('Auth')

  registerEventHandler(CoreEventType.AuthCodeNeeded, () => {
    useAccountStore().auth.needCode = true
    useAccountStore().auth.isLoading = false
  })

  registerEventHandler(CoreEventType.AuthPasswordNeeded, () => {
    useAccountStore().auth.needPassword = true
    useAccountStore().auth.isLoading = false
  })

  registerEventHandler(CoreEventType.AuthConnected, () => {
    logger.log('Auth connected')
  })

  registerEventHandler(CoreEventType.AuthDisconnected, () => {
    logger.log('Auth disconnected, cleaning up session metadata')
    useAccountStore().stopRecovery()
  })

  // Browser mode keeps the StringSession locally. Server mode persists it in the
  // database, so the forwarded value must not become the client authority.
  registerEventHandler(CoreEventType.SessionUpdate, ({ session: sessionString }) => {
    useSessionStore().applySessionUpdate(sessionString)
  })

  registerEventHandler(CoreEventType.AuthError, () => {
    useAccountStore().retryLogin()
  })
}
