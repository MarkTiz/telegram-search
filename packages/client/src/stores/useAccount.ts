import { useLogger } from '@guiiai/logg'
import { CoreEventType, generateDefaultAccountSettings } from '@tg-search/core'
import { acceptHMRUpdate, defineStore } from 'pinia'
import { onScopeDispose, ref, watch } from 'vue'
import { toast } from 'vue-sonner'

import { useBridge } from '../composables/useBridge'
import { IS_CORE_MODE, TELEGRAM_APP_HASH, TELEGRAM_APP_ID } from '../constants'
import { useChatStore } from './useChat'
import { useMessageStore } from './useMessage'
import { useSessionStore } from './useSession'

export const useAccountStore = defineStore('account', () => {
  const logger = useLogger('AccountStore')
  const bridge = useBridge()
  const sessionStore = useSessionStore()

  // --- Auth State ---
  const authStatus = ref({
    needCode: false,
    needPassword: false,
    isLoading: false,
    qrUrl: '' as string,
    qrExpires: 0 as number,
  })

  let attemptCounter = 0
  let reconnectTimer: number | undefined
  let configTimer: number | undefined
  let recoveryAllowed = true
  let restoringSession = false

  function cancelRetry() {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  // --- Account State ---
  const accountSettings = ref(generateDefaultAccountSettings())
  const hasFetchedSettings = ref(false)

  const isReady = ref(false)

  const syncStatus = ref<'idle' | 'syncing' | 'error'>('idle')

  // --- Actions: Auth ---

  /**
   * Best-effort auto-login using stored Telegram session string.
   */
  const attemptLogin = async () => {
    if (!recoveryAllowed || authStatus.value.isLoading)
      return

    if (!sessionStore.activeSession?.session) {
      if (sessionStore.serverAuthority)
        logger.verbose('Waiting for the server Telegram session')
      else
        logger.verbose('No session, skipping login')
      return
    }

    if (isReady.value) {
      logger.verbose('Account is ready, fetching dialogs')
      useChatStore().fetchStorageDialogs()
      useChatStore().fetchDialogs()
      useChatStore().fetchFolders()
      return
    }

    if (IS_CORE_MODE && (!TELEGRAM_APP_ID || !TELEGRAM_APP_HASH)) {
      toast.error('Missing Telegram API credentials')
      authStatus.value.isLoading = false
      return
    }

    resetReady()
    authStatus.value.isLoading = true
    restoringSession = true
    logger.log('Attempting login')
    bridge.sendEvent(CoreEventType.AuthLogin, { session: sessionStore.activeSession?.session })
  }

  function handleAuth() {
    function clearQrState() {
      authStatus.value.qrUrl = ''
      authStatus.value.qrExpires = 0
    }

    function login(phoneNumber: string) {
      cancelRetry()
      recoveryAllowed = true
      restoringSession = false
      clearQrState()
      // NOTICE: session can be undefined. Phone login is a new login.
      // Server mode does not resend a stored StringSession; the server already has it.
      const session = sessionStore.serverAuthority ? undefined : sessionStore.activeSession?.session
      if (IS_CORE_MODE && (!TELEGRAM_APP_ID || !TELEGRAM_APP_HASH)) {
        toast.error('Missing Telegram API credentials')
        authStatus.value.isLoading = false
        return
      }

      authStatus.value.isLoading = true
      bridge.sendEvent(CoreEventType.AuthLogin, {
        phoneNumber,
        session,
        method: 'phone',
      })
    }

    function loginWithQr() {
      cancelRetry()
      recoveryAllowed = true
      restoringSession = false
      clearQrState()
      if (IS_CORE_MODE && (!TELEGRAM_APP_ID || !TELEGRAM_APP_HASH)) {
        toast.error('Missing Telegram API credentials')
        authStatus.value.isLoading = false
        return
      }

      authStatus.value.isLoading = true
      bridge.sendEvent(CoreEventType.AuthLogin, {
        method: 'qr',
      })
    }

    function cancelLogin() {
      clearQrState()
      authStatus.value.isLoading = false
      bridge.sendEvent(CoreEventType.AuthLoginCancel, undefined)
    }

    function submitCode(code: string) {
      bridge.sendEvent(CoreEventType.AuthCode, { code })
    }

    function submitPassword(password: string) {
      bridge.sendEvent(CoreEventType.AuthPassword, { password })
    }

    function logout() {
      stopRecovery()
      try {
        bridge.sendEvent(CoreEventType.AuthLogout, undefined)
      }
      finally {
        sessionStore.removeCurrentAccount()
      }
    }

    function switchAccount(sessionId: string) {
      // When switching accounts, clear message window/state so that chats
      // from the previous account do not bleed into the new one.
      useMessageStore().reset()
      sessionStore.switchAccount(sessionId)
      resetReady()
    }

    function addNewAccount() {
      sessionStore.addNewAccount()
      resetReady()
    }

    function getAllAccounts() {
      return Object.values(sessionStore.sessions)
    }

    return { login, loginWithQr, cancelLogin, submitCode, submitPassword, logout, switchAccount, addNewAccount, getAllAccounts }
  }

  // --- Actions: Account Lifecycle ---

  function markReady() {
    cancelRetry()
    attemptCounter = 0
    restoringSession = false
    if (isReady.value)
      return

    logger.verbose('Marking account as ready')
    // NOTICE: config:data forwarding depends on websocket event registration.
    // Requesting immediately here can race with server:event:register on fresh
    // reconnects, so view layers also issue an explicit fetch when needed.
    configTimer = window.setTimeout(() => {
      configTimer = undefined
      logger.verbose('Fetching config for new session')
      bridge.sendEvent(CoreEventType.ConfigFetch)
    }, 150)

    isReady.value = true
    authStatus.value.isLoading = false
    useChatStore().init()
  }

  function resetReady() {
    cancelRetry()
    restoringSession = false
    window.clearTimeout(configTimer)
    configTimer = undefined
    isReady.value = false
    authStatus.value.isLoading = false
    syncStatus.value = 'idle'
    hasFetchedSettings.value = false
  }

  function retryLogin() {
    authStatus.value.isLoading = false
    if (!restoringSession || !recoveryAllowed || isReady.value || !sessionStore.activeSession?.session || reconnectTimer !== undefined)
      return

    const delayMs = Math.min(2000 * (2 ** Math.min(attemptCounter++, 4)), 30000)
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined
      void attemptLogin()
    }, delayMs)
  }

  function stopRecovery() {
    recoveryAllowed = false
    resetReady()
  }

  watch(() => sessionStore.activeSessionId, () => {
    resetReady()
    attemptCounter = 0
    recoveryAllowed = true
  }, { flush: 'sync' })

  onScopeDispose(() => {
    cancelRetry()
    window.clearTimeout(configTimer)
  })

  function init() {
    logger.verbose('Initializing account')
    // Try to restore connection using stored session for the active slot.
    void attemptLogin()
  }

  return {
    // State
    auth: authStatus,
    accountSettings,
    hasFetchedSettings,
    isReady,
    syncStatus,

    // Actions
    init,
    handleAuth,
    markReady,
    resetReady,
    retryLogin,
    stopRecovery,
  }
})

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAccountStore, import.meta.hot))
}
