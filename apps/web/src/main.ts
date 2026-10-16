import NProgress from 'nprogress'

import { autoAnimatePlugin } from '@formkit/auto-animate/vue'
import { initLogger, LoggerFormat } from '@guiiai/logg'
import { VueQueryPlugin } from '@tanstack/vue-query'
import { useAccountStore, useSessionStore } from '@tg-search/client'
import { createPinia } from 'pinia'
import { setupLayouts } from 'virtual:generated-layouts'
import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import { routes as generatedRoutes } from 'vue-router/auto-routes'

import App from './App.vue'

import { LOG_LEVEL } from './constants'
import { i18n } from './modules/i18n'
import { initPosthog } from './modules/posthog'
import { createPGliteDevtoolsPlugin } from './plugins/pglite-devtools'

import '@unocss/reset/tailwind.css'
import 'nprogress/nprogress.css'
import 'uno.css'
import 'markstream-vue/index.css'
import 'vue-sonner/style.css'
import './styles/main.css'

initPosthog()
initLogger(LOG_LEVEL, LoggerFormat.Pretty)

async function bootstrap() {
  const app = createApp(App)

  const pinia = createPinia()
  app.use(pinia)

  const sessionStore = useSessionStore()
  sessionStore.init()
  // Resolve server catalog before the first navigation so returning users with
  // persisted server sessions never flash the Telegram Login / success screen.
  await sessionStore.prepareServerSessions()

  const routes = setupLayouts([
    ...generatedRoutes.filter(_ => true),
    {
      path: '/search/:pathMatch(.*)*',
      redirect: '/chats',
    },
  ])
  const router = createRouter({
    routes,
    history: createWebHistory(import.meta.env.BASE_URL),
  })

  // Configure NProgress
  NProgress.configure({ showSpinner: false })

  // Add router navigation guards for NProgress
  router.beforeEach((to) => {
    NProgress.start()

    const accountStore = useAccountStore()
    const isLoginRoute = to.path === '/login'
    // isReady waits for websocket AccountReady; hasActivePersistedAuth covers
    // server-catalog / local StringSession so we do not bounce to /login first.
    // addNewAccount() clears me/session on the active slot, so /login stays reachable.
    const hasValidLogin = accountStore.isReady || sessionStore.hasActivePersistedAuth

    if (!isLoginRoute && !hasValidLogin) {
      return {
        path: '/login',
        query: { redirect: to.fullPath },
      }
    }
    if (isLoginRoute && hasValidLogin) {
      const redirect = typeof to.query.redirect === 'string' ? to.query.redirect : '/'
      return redirect
    }
    return true
  })

  router.afterEach(() => {
    NProgress.done()
  })

  router.onError(() => {
    NProgress.done()
  })

  app.use(i18n)
  app.use(router)
  app.use(VueQueryPlugin)
  app.use(autoAnimatePlugin)
  app.use(createPGliteDevtoolsPlugin())

  app.mount('#app')
}

void bootstrap()
