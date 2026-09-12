<script setup lang="ts">
import { computed } from 'vue'
import type { ConnectionState } from './socket'

const props = defineProps<{
  connection: ConnectionState
  revision: number | null
}>()
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
