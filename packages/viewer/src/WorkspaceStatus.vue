<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectionState } from './socket'

const props = defineProps<{
  connection: ConnectionState
  revision: number | null
  /** Edits still on their way to the file. */
  saving?: boolean
  /** Whether anything has been written this session, so "Saved" means something. */
  saved?: boolean
}>()
/**
 * What the file knows, said the way Webflow's check mark and Penpot's file
 * status say it: a designer never opens the file, so this is how they learn
 * the last change reached it.
 */
const fileState = computed(() => {
  if (props.connection !== 'open') return null
  if (props.saving) return { text: 'Saving…', state: 'saving' }
  if (props.saved) return { text: 'All changes saved', state: 'saved' }
  return null
})
const label = computed(
  () =>
    ({
      open: 'Connected',
      connecting: 'Connecting…',
      reconnecting: 'Reconnecting…',
      closed: 'Disconnected',
    })[props.connection],
)
</script>

<template>
  <footer class="workspace-status">
    <span
      class="connection"
      :data-state="connection"
      role="status"
      :title="revision === null ? label : `${label} · Revision ${revision}`"
    >
      <span class="connection-dot" aria-hidden="true" />{{ label }}
    </span>
    <span v-if="fileState" class="file-state" :data-state="fileState.state" role="status">
      <svg
        v-if="fileState.state === 'saved'"
        width="10"
        height="10"
        viewBox="0 0 10 10"
        aria-hidden="true"
      >
        <path
          d="M1.5 5.5 4 8l4.5-6"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
      {{ fileState.text }}
    </span>
  </footer>
</template>

<style scoped>
.workspace-status {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 48px;
  padding: 8px 12px;
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.connection {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
}
.file-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10px;
  color: var(--text-dim);
  white-space: nowrap;
}
.file-state[data-state='saved'] {
  color: var(--ok);
}
.connection-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn);
}
.connection[data-state='open'] .connection-dot {
  background: var(--ok);
}
.connection[data-state='closed'] .connection-dot {
  background: var(--danger);
}
</style>
