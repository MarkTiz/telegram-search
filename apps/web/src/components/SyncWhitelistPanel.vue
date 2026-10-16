<script setup lang="ts">
import type { CoreDialog } from '@tg-search/core/types'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import EntityAvatar from './avatar/EntityAvatar.vue'
import { Input } from './ui/Input'
import { Switch } from './ui/Switch'

const props = defineProps<{
  chats: CoreDialog[]
  whitelistChatIds: string[]
  saving?: boolean
}>()

const emit = defineEmits<{
  toggle: [chatId: string, enabled: boolean]
}>()

const { t } = useI18n()
const searchQuery = ref('')

const whitelistSet = computed(() => new Set(props.whitelistChatIds.map(String)))

const filteredChats = computed(() => {
  let list = props.chats
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(chat =>
      chat.name?.toLowerCase().includes(q)
      || String(chat.id).includes(q),
    )
  }
  return list
})

const enabledCount = computed(() => props.whitelistChatIds.length)

function isEnabled(chatId: number) {
  return whitelistSet.value.has(String(chatId))
}

function onToggle(chatId: number, enabled: boolean) {
  emit('toggle', String(chatId), enabled)
}
</script>

<template>
  <div class="h-full flex flex-col gap-3">
    <div class="space-y-1 px-1">
      <p class="text-sm text-muted-foreground">
        {{ t('sync.whitelistDescription') }}
      </p>
      <p class="text-xs text-muted-foreground">
        {{ t('sync.whitelistEnabledCount', { count: enabledCount }) }}
        <span v-if="enabledCount === 0"> — {{ t('sync.whitelistEmptyHint') }}</span>
      </p>
    </div>

    <div class="group relative px-1">
      <div class="i-lucide-search absolute left-3 top-1/2 h-4 w-4 text-muted-foreground -translate-y-1/2" />
      <Input
        v-model="searchQuery"
        :placeholder="t('sync.whitelistSearchPlaceholder')"
        class="h-9 pl-9"
      />
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto border rounded-xl bg-card/40">
      <div
        v-if="filteredChats.length === 0"
        class="flex items-center justify-center py-16 text-sm text-muted-foreground"
      >
        {{ t('sync.whitelistNoChats') }}
      </div>
      <ul v-else class="divide-y">
        <li
          v-for="chat in filteredChats"
          :key="chat.id"
          class="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40"
        >
          <EntityAvatar
            :id="chat.id"
            entity="other"
            entity-type="chat"
            :file-id="chat.avatarFileId"
            :name="chat.name"
            size="sm"
            class="shrink-0"
          />
          <div class="min-w-0 flex-1">
            <div class="truncate text-sm font-medium">
              {{ chat.name || chat.id }}
            </div>
            <div class="truncate text-xs text-muted-foreground">
              {{ chat.type }} · {{ chat.id }}
              <template v-if="chat.messageCount != null">
                · {{ chat.messageCount }}
              </template>
            </div>
          </div>
          <Switch
            :checked="isEnabled(chat.id)"
            :disabled="saving"
            @update:checked="(v: boolean) => onToggle(chat.id, v)"
          />
        </li>
      </ul>
    </div>
  </div>
</template>
