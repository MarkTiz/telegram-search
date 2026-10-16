<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
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
  accounts: AgentConfigAccount[]
}

const { t } = useI18n()

const loading = ref(true)
const saving = ref(false)
const enabled = ref(false)
const accounts = ref<AgentConfigAccount[]>([])
/** Local edits: accountId -> Set of chatIds */
const selectedByAccount = ref<Record<string, Set<string>>>({})
const dirty = ref(false)
const lastSavedAt = ref<number | null>(null)

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

const totalSelected = computed(() =>
  Object.values(selectedByAccount.value).reduce((sum, set) => sum + set.size, 0),
)

function clearSaveTimer() {
  if (saveTimer != null) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function scheduleSave() {
  dirty.value = true
  clearSaveTimer()
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveConfig({ quiet: true })
  }, 400)
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
    const next: Record<string, Set<string>> = {}
    for (const account of accounts.value) {
      next[account.accountId] = new Set((account.agentApiChatIds ?? []).map(String))
    }
    selectedByAccount.value = next
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

function isSelected(accountId: string, chatId: string) {
  return selectedByAccount.value[accountId]?.has(String(chatId)) ?? false
}

function onEnabledChange(checked: boolean) {
  enabled.value = !!checked
  scheduleSave()
}

function toggleChat(accountId: string, chatId: string, checked: boolean) {
  const set = new Set(selectedByAccount.value[accountId] ?? [])
  if (checked)
    set.add(String(chatId))
  else
    set.delete(String(chatId))
  selectedByAccount.value = {
    ...selectedByAccount.value,
    [accountId]: set,
  }
  scheduleSave()
}

async function saveConfig(options?: { quiet?: boolean }) {
  clearSaveTimer()
  const quiet = options?.quiet === true

  // Serialize saves so rapid toggles cannot race and overwrite each other.
  const run = async () => {
    saving.value = true
    try {
      const body = {
        enabled: enabled.value,
        accounts: accounts.value.map(account => ({
          accountId: account.accountId,
          chatIds: [...(selectedByAccount.value[account.accountId] ?? [])].map(String),
        })),
      }
      const res = await fetch('/api/agent/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok)
        throw new Error(`HTTP ${res.status}`)

      // Re-load from server so UI matches persisted prune/normalize result.
      const verify = await fetch('/api/agent/config', { cache: 'no-store' })
      if (!verify.ok)
        throw new Error(`HTTP ${verify.status}`)
      const data = await verify.json() as AgentConfigResponse
      enabled.value = !!data.enabled
      accounts.value = data.accounts ?? []
      const next: Record<string, Set<string>> = {}
      for (const account of accounts.value) {
        next[account.accountId] = new Set((account.agentApiChatIds ?? []).map(String))
      }
      selectedByAccount.value = next
      dirty.value = false
      lastSavedAt.value = Date.now()
      if (!quiet)
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

  saveChain = saveChain.then(run, run)
  await saveChain
}

onMounted(() => {
  loadConfig()
})

onUnmounted(() => {
  clearSaveTimer()
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
        <span v-if="dirty || saving" class="ml-2">
          · {{ saving ? t('aiChat.agentApiSaving') : t('aiChat.agentApiPendingSave') }}
        </span>
        <span v-else-if="lastSavedAt" class="ml-2">
          · {{ t('aiChat.agentApiAutoSaved') }}
        </span>
      </p>

      <div
        v-if="accounts.length === 0"
        class="border rounded-xl py-12 text-center text-sm text-muted-foreground"
      >
        {{ t('aiChat.agentApiNoAccounts') }}
      </div>

      <section
        v-for="account in accounts"
        :key="account.accountId"
        class="border rounded-xl bg-card/40"
      >
        <header class="flex items-center justify-between border-b px-4 py-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">
              {{ account.displayName }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ account.platformUserId || account.accountId }}
            </div>
          </div>
          <div class="text-xs text-muted-foreground">
            {{ t('aiChat.agentApiAccountSelected', {
              count: selectedByAccount[account.accountId]?.size ?? 0,
              total: account.chats.length,
            }) }}
          </div>
        </header>

        <div
          v-if="account.chats.length === 0"
          class="px-4 py-8 text-center text-sm text-muted-foreground"
        >
          {{ t('aiChat.agentApiNoWhitelistChats') }}
        </div>

        <ul v-else class="divide-y">
          <li
            v-for="chat in account.chats"
            :key="`${account.accountId}:${chat.chatId}`"
            class="flex cursor-pointer items-center gap-3 px-4 py-2.5 hover:bg-muted/30"
            @click="toggleChat(account.accountId, chat.chatId, !isSelected(account.accountId, chat.chatId))"
          >
            <Checkbox
              :checked="isSelected(account.accountId, chat.chatId)"
              :disabled="saving"
              @click.stop
              @update:checked="(v) => toggleChat(account.accountId, chat.chatId, v === true)"
            />
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-medium">
                {{ chat.name || chat.chatId }}
              </div>
              <div class="truncate text-xs text-muted-foreground">
                {{ chat.type }} · {{ chat.chatId }}
              </div>
            </div>
          </li>
        </ul>
      </section>

      <div class="flex items-center justify-end gap-2 pb-4">
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
