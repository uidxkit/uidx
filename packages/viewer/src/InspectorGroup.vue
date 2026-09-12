<script setup lang="ts">
import { computed } from 'vue'
import type { InspectorGroup } from './inspector-layout'
const props = defineProps<{ group: InspectorGroup }>()
const authored = computed(
  () =>
    props.group.fields
      .flatMap((row) => (row.pairedWith ? [row.field, row.pairedWith] : [row.field]))
      .filter((field) => field.authored).length,
)
</script>

<template>
  <details v-if="group.advanced" class="inspector-group advanced" :data-inspector-group="group.id">
    <summary>
      <span class="disclosure" aria-hidden="true">›</span>
      <span>{{ group.label }}</span>
      <span v-if="authored" class="configured" :title="`${authored} properties set on this layer`"
        >{{ authored }} set</span
      >
    </summary>
    <div class="group-content"><slot /></div>
  </details>
  <div v-else class="inspector-group" :data-inspector-group="group.id">
    <h4 v-if="group.label">{{ group.label }}</h4>
    <slot />
  </div>
</template>

<style scoped>
.inspector-group {
  min-width: 0;
}
h4 {
  margin: 12px 0 4px;
  font: inherit;
  font-weight: 600;
  color: var(--text-dim);
}
.advanced {
  margin-top: 8px;
  border-top: 1px solid var(--line);
}
summary {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  cursor: pointer;
  list-style: none;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  user-select: none;
}
summary::-webkit-details-marker {
  display: none;
}
summary:hover {
  color: var(--text);
}
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
}
.disclosure {
  font-size: 16px;
  transition: transform 0.1s;
}
details[open] .disclosure {
  transform: rotate(90deg);
}
.configured {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 10px;
  padding: 0 5px;
  background: var(--raised);
  border-radius: var(--radius-lg);
}
.group-content {
  padding-bottom: 4px;
}
</style>
