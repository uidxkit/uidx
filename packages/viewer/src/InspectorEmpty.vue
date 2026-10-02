<script setup lang="ts">
import { ref } from 'vue'

import type { MessageAction } from './inspector-messages'

/**
 * The one empty state of the Contract, Connect and Code tabs: a dim title,
 * one line of hint, and at most one action. Nothing selected, several
 * layers, a layer outside every component — each tab says it the same way,
 * in words from `inspector-messages`.
 *
 * The long "what is this tab for" text sits in a closed disclosure, shown
 * only when nothing is selected; whether a reader opened it is remembered,
 * so it stays out of the way for those who have read it.
 */
defineProps<{
  /** Which empty state this is, as `data-empty` for tests and styling. */
  kind: string
  title: string
  hint?: string
  action?: MessageAction
  about?: { label: string; text: string }
}>()

const emit = defineEmits<{ act: [action: MessageAction] }>()

const ABOUT_KEY = 'uidx.inspector.about'

function readOpen(): boolean {
  try {
    return localStorage.getItem(ABOUT_KEY) === 'open'
  } catch {
    return false
  }
}
const aboutOpen = ref(readOpen())

function remember(event: Event): void {
  aboutOpen.value = (event.target as HTMLDetailsElement).open
  try {
    localStorage.setItem(ABOUT_KEY, aboutOpen.value ? 'open' : 'closed')
  } catch {
    // Storage blocked: the disclosure still works, it just forgets.
  }
}
</script>

<template>
  <div class="empty-state" :data-empty="kind">
    <p class="empty-title">{{ title }}</p>
    <p v-if="hint" class="empty-hint">{{ hint }}</p>
    <button
      v-if="action"
      type="button"
      class="link-button"
      :title="action.label"
      @click="emit('act', action)"
    >
      {{ action.label }}
    </button>
    <details v-if="about" class="about" :open="aboutOpen" @toggle="remember">
      <summary><span class="disclosure" aria-hidden="true">›</span>{{ about.label }}</summary>
      <p>{{ about.text }}</p>
    </details>
  </div>
</template>

<style scoped>
.empty-state {
  padding: 12px 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
.empty-title {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--ui-size);
  font-weight: 500;
  line-height: 18px;
}
.empty-hint {
  margin: 2px 0 0;
  /* A message, not metadata: --text-faint is under 4.5:1 on the light panel. */
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
/* One line, left-aligned like the text above it, however long the name it
   carries ('Open PrimaryNavigationSidebar…'); the full label is its title. */
.empty-state > .link-button {
  display: block;
  max-width: 100%;
  margin-top: 8px;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-size-sm);
  font-weight: 500;
}
.about {
  margin-top: 12px;
  border-top: 1px solid var(--line);
}
.about > summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  list-style: none;
  cursor: pointer;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  user-select: none;
}
.about > summary::-webkit-details-marker {
  display: none;
}
.about > summary:hover {
  color: var(--text);
}
.disclosure {
  font-size: 16px;
  transition: transform 0.1s;
}
.about[open] .disclosure {
  transform: rotate(90deg);
}
.about p {
  margin: 0 0 8px;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
</style>
