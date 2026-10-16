<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import EntityAvatar from './avatar/EntityAvatar.vue'
import { Button } from './ui/Button'
import { Switch } from './ui/Switch'

interface AgentConfigChat {
  chatId: string
  name: string
  type: string
}

interface AgentConfigAccount {
  accountId: string
  platform: string
  platformUserId: string
  displayName: string
  syncWhitelistChatIds: string[]
  agentApiChatIds: string[]
  chats: AgentConfigChat[]
}

interface AgentConfigResponse {
  enabled: boolean
  entries?: Array<{ accountId: string, chatId: string }>
  accounts: AgentConfigAccount[]
}

const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const enabled = ref(false)
const accounts = ref<AgentConfigAccount[]>([])
/**
 * Flat reactive map keyed by `${accountId}:${chatId}` → true when enabled.
 * Avoids nested Set reactivity / Checkbox controlled-state quirks.
 */
const selectedMap = ref<Record<string, boolean>>({})
const dirty = ref(false)

function entryKey(accountId: string, chatId: string | number) {
  return `${accountId}:${String(chatId)}`
}

function applySelectionFromConfig(data: AgentConfigResponse) {
  const next: Record<string, boolean> = {}
  if (data.entries?.length) {
    for (const entry of data.entries)
      next[entryKey(entry.accountId, entry.chatId)] = true
  }
  else {
    for (const account of data.accounts ?? []) {
      for (const chatId of account.agentApiChatIds ?? [])
        next[entryKey(account.accountId, chatId)] = true
    }
  }
  selectedMap.value = next
}

/** Only accounts that have sync-whitelist chats — hide empty ones entirely. */
const visibleAccounts = computed(() =>
  accounts.value.filter(account => (account.chats?.length ?? 0) > 0),
)

const totalSelected = computed(() =>
  Object.values(selectedMap.value).filter(Boolean).length,
)

function selectedCountForAccount(accountId: string) {
  const prefix = `${accountId}:`
  let count = 0
  for (const [key, on] of Object.entries(selectedMap.value)) {
    if (on && key.startsWith(prefix))
      count++
  }
  return count
}

function isSelected(accountId: string, chatId: string | number) {
  return selectedMap.value[entryKey(accountId, chatId)] === true
}

function markDirty() {
  dirty.value = true
}

async function loadConfig() {
  loading.value = true
  try {
    const res = await fetch('/api/agent/config', { cache: 'no-store' })
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as AgentConfigResponse
    enabled.value = !!data.enabled
    accounts.value = data.accounts ?? []
    applySelectionFromConfig(data)
    dirty.value = false
  }
  catch (error) {
    toast.error(t('aiChat.agentApiLoadFailed'))
    console.error(error)
  }
  finally {
    loading.value = false
  }
}

function onEnabledChange(checked: boolean) {
  enabled.value = !!checked
  markDirty()
}

function onChatToggle(accountId: string, chatId: string | number, checked: boolean) {
  const key = entryKey(accountId, chatId)
  selectedMap.value = {
    ...selectedMap.value,
    [key]: !!checked,
  }
  markDirty()
}

function setAccountChatsEnabled(account: AgentConfigAccount, enabledAll: boolean) {
  const next = { ...selectedMap.value }
  for (const chat of account.chats ?? [])
    next[entryKey(account.accountId, chat.chatId)] = enabledAll
  selectedMap.value = next
  markDirty()
}

async function saveConfig() {
  const run = async () => {
    saving.value = true
    try {
      const body = {
        enabled: enabled.value,
        accounts: accounts.value.map((account) => {
          const chatIds = (account.chats ?? [])
            .map(chat => String(chat.chatId))
            .filter(chatId => selectedMap.value[entryKey(account.accountId, chatId)] === true)
          return {
            accountId: account.accountId,
            chatIds,
          }
        }),
      }
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)

      const verify = await fetch('/api/agent/config', { cache: 'no-store' })
      if (!verify.ok)
        throw new Error(`HTTP ${verify.status}`)
      const data = await verify.json() as AgentConfigResponse
      enabled.value = !!data.enabled
      accounts.value = data.accounts ?? []
      applySelectionFromConfig(data)
      dirty.value = false
      toast.success(t('aiChat.agentApiSaved'))
    }
    catch (error) {
      toast.error(t('aiChat.agentApiSaveFailed'))
      console.error(error)
    }
    finally {
      saving.value = false
    }
  }

  await run()
}

onMounted(() => {
  loadConfig()
})
</script>

<template>
  <div class="mx-auto h-full max-w-3xl flex flex-col gap-4 overflow-y-auto p-4 md:p-6">
    <div class="space-y-1">
      <h2 class="text-base font-semibold">
        {{ t('aiChat.agentApiTitle') }}
      </h2>
      <p class="text-sm text-muted-foreground">
        {{ t('aiChat.agentApiDescription') }}
      </p>
    </div>

    <div
      v-if="loading"
      class="flex flex-1 items-center justify-center text-sm text-muted-foreground"
    >
      <span class="i-lucide-loader-circle mr-2 h-4 w-4 animate-spin" />
      {{ t('aiChat.agentApiLoading') }}
    </div>

    <template v-else>
      <div class="flex items-center justify-between border rounded-xl bg-card/50 px-4 py-3">
        <div class="space-y-0.5">
          <div class="text-sm font-medium">
            {{ t('aiChat.agentApiEnable') }}
          </div>
          <div class="text-xs text-muted-foreground">
            {{ t('aiChat.agentApiEnableHint') }}
          </div>
        </div>
        <Switch
          :checked="enabled"
          :disabled="saving"
          @update:checked="onEnabledChange"
        />
      </div>

      <p class="text-xs text-muted-foreground">
        {{ t('aiChat.agentApiSelectedCount', { count: totalSelected }) }}
        <span v-if="enabled && totalSelected === 0"> — {{ t('aiChat.agentApiEmptyHint') }}</span>
        <span v-if="dirty || saving" class="ml-2 text-amber-600 dark:text-amber-400">
          · {{ saving ? t('aiChat.agentApiSaving') : t('aiChat.agentApiPendingSave') }}
        </span>
      </p>

      <div
        v-if="accounts.length === 0"
        class="border rounded-xl py-12 text-center text-sm text-muted-foreground"
      >
        {{ t('aiChat.agentApiNoAccounts') }}
      </div>

      <section
        v-for="account in visibleAccounts"
        :key="account.accountId"
        class="overflow-hidden border rounded-xl bg-card/40"
      >
        <header class="flex flex-wrap items-center gap-3 border-b bg-muted/20 px-4 py-3">
          <EntityAvatar
            v-if="account.platformUserId"
            :id="account.platformUserId"
            entity="other"
            entity-type="user"
            :name="account.displayName"
            size="sm"
            class="shrink-0 ring-1 ring-border/40"
          />
          <div
            v-else
            class="h-8 w-8 flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
          >
            <span class="i-lucide-user h-4 w-4" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {{ account.displayName }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ account.platformUserId || account.accountId }}
              · {{ t('aiChat.agentApiAccountSelected', {
                count: selectedCountForAccount(account.accountId),
                total: account.chats.length,
              }) }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs"
              :disabled="saving || selectedCountForAccount(account.accountId) === account.chats.length"
              @click="setAccountChatsEnabled(account, true)"
            >
              {{ t('aiChat.agentApiEnableAll') }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="h-7 px-2.5 text-xs"
              :disabled="saving || selectedCountForAccount(account.accountId) === 0"
              @click="setAccountChatsEnabled(account, false)"
            >
              {{ t('aiChat.agentApiDisableAll') }}
            </Button>
          </div>
        </header>

        <ul class="divide-y">
          <li
            v-for="chat in account.chats"
            :key="entryKey(account.accountId, chat.chatId)"
            class="flex items-center gap-3 px-4 py-2.5 transition-colors"
            :class="isSelected(account.accountId, chat.chatId)
              ? 'bg-primary/10'
              : 'hover:bg-muted/30'"
          >
            <EntityAvatar
              :id="chat.chatId"
              entity="other"
              entity-type="chat"
              :name="chat.name"
              size="sm"
              class="shrink-0"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {{ chat.name || chat.chatId }}
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {{ chat.type }} · {{ chat.chatId }}
              </div>
            </div>
            <Switch
              :key="`${entryKey(account.accountId, chat.chatId)}:${isSelected(account.accountId, chat.chatId)}`"
              :checked="isSelected(account.accountId, chat.chatId)"
              :disabled="saving"
              @update:checked="(v) => onChatToggle(account.accountId, chat.chatId, v)"
            />
          </li>
        </ul>
      </section>

      <div class="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur-sm">
        <Button
          variant="outline"
          :disabled="loading || saving"
          @click="loadConfig"
        >
          {{ t('aiChat.agentApiReload') }}
        </Button>
        <Button
          :disabled="loading || saving || !dirty"
          @click="saveConfig()"
        >
          <span v-if="saving" class="i-lucide-loader-circle mr-2 h-4 w-4 animate-spin" />
          {{ t('aiChat.agentApiSave') }}
        </Button>
      </div>
    </template>
  </div>
</template>
