import { useAccountStore, useAvatarStore, useSessionStore } from '@tg-search/client'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import { loginTokenToQrDataUrl } from '../utils/qr'

export type LoginMethod = 'phone' | 'qr'
export type LoginStep = 'phone' | 'code' | 'password' | 'qr' | 'complete'

export function useLoginFlow() {
  const { t } = useI18n()
  const router = useRouter()
  const route = useRoute()

  const accountStore = useAccountStore()
  const { activeSession } = storeToRefs(useSessionStore())
  const avatarStore = useAvatarStore()
  const { isReady } = storeToRefs(accountStore)

  const state = ref({
    method: 'phone' as LoginMethod,
    currentStep: 'phone' as LoginStep,
    phoneNumber: '',
    verificationCode: '',
    twoFactorPassword: '',
  })

  accountStore.auth.needCode = false
  accountStore.auth.needPassword = false
  accountStore.auth.isLoading = false
  accountStore.auth.qrUrl = ''
  accountStore.auth.qrExpires = 0

  const {
    login,
    loginWithQr,
    cancelLogin,
    submitCode,
    submitPassword,
  } = accountStore.handleAuth()

  const qrDataUrl = computed(() => {
    const url = accountStore.auth.qrUrl
    if (!url)
      return ''
    try {
      return loginTokenToQrDataUrl(url)
    }
    catch (error) {
      console.error('Failed to render login QR', error)
      return ''
    }
  })

  watch(() => accountStore.auth.needCode, (value) => {
    if (value) {
      accountStore.auth.isLoading = false
      state.value.currentStep = 'code'
    }
  })

  watch(() => accountStore.auth.needPassword, (value) => {
    if (value) {
      accountStore.auth.isLoading = false
      state.value.currentStep = 'password'
    }
  })

  watch(() => accountStore.auth.qrUrl, (value) => {
    if (value && state.value.method === 'qr') {
      accountStore.auth.isLoading = false
      state.value.currentStep = 'qr'
    }
  })

  function redirectRoot() {
    const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : undefined
    router.replace(redirect || '/sync')
  }

  // NOTICE: Returning users hit /login while websocket AccountReady is still false.
  // When the server session reconnects (or an interactive login finishes), leave
  // immediately — do not park on the "Login successful!" interstitial.
  watch(isReady, (value) => {
    if (!value)
      return

    accountStore.auth.isLoading = false
    accountStore.auth.qrUrl = ''
    accountStore.auth.qrExpires = 0

    if (activeSession.value?.me?.id) {
      avatarStore.ensureUserAvatar(activeSession.value.me.id, undefined, true)
    }

    redirectRoot()
  }, { immediate: true })

  const steps = computed(() => {
    if (state.value.method === 'qr') {
      return [
        { step: 1, value: 'qr', title: t('login.qr'), description: t('login.qrDescription') },
        { step: 2, value: 'password', title: t('login.password'), description: t('login.passwordDescription') },
        { step: 3, value: 'complete', title: t('login.complete'), description: t('login.completeDescription') },
      ]
    }

    return [
      { step: 1, value: 'phone', title: t('login.phone'), description: t('login.phoneDescription') },
      { step: 2, value: 'code', title: t('login.code'), description: t('login.codeDescription') },
      { step: 3, value: 'password', title: t('login.password'), description: t('login.passwordDescription') },
      { step: 4, value: 'complete', title: t('login.complete'), description: t('login.completeDescription') },
    ]
  })

  async function handleLogin() {
    accountStore.auth.isLoading = true

    try {
      switch (state.value.currentStep) {
        case 'phone':
          login(state.value.phoneNumber)
          break
        case 'code':
          submitCode(state.value.verificationCode)
          break
        case 'password':
          submitPassword(state.value.twoFactorPassword)
          break
        case 'qr':
          loginWithQr()
          break
      }
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    }
  }

  function switchToPhone() {
    if (state.value.method === 'qr' || state.value.currentStep === 'qr') {
      cancelLogin()
    }

    state.value.method = 'phone'
    state.value.currentStep = 'phone'
    accountStore.auth.needCode = false
    accountStore.auth.needPassword = false
    accountStore.auth.isLoading = false
    accountStore.auth.qrUrl = ''
    accountStore.auth.qrExpires = 0
  }

  function switchToQr() {
    if (state.value.method === 'phone' && accountStore.auth.isLoading) {
      cancelLogin()
    }

    state.value.method = 'qr'
    state.value.currentStep = 'qr'
    accountStore.auth.needCode = false
    accountStore.auth.needPassword = false
    accountStore.auth.qrUrl = ''
    accountStore.auth.qrExpires = 0
    accountStore.auth.isLoading = true
    loginWithQr()
  }

  return {
    accountStore,
    state,
    steps,
    qrDataUrl,
    handleLogin,
    switchToPhone,
    switchToQr,
    redirectRoot,
  }
}
