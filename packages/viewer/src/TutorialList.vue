<script setup lang="ts">
import { completedTutorials } from './tour'
import { TUTORIALS } from './tutorials'

/** The tutorials as cards to start one from: on the Overview and in the Learn menu. */
defineProps<{ compact?: boolean }>()
const emit = defineEmits<{ start: [id: string] }>()

const ICONS: Record<string, string> = {
  button: 'M3 6.5h10a2 2 0 0 1 0 4H3a2 2 0 0 1 0-4z',
  switch: 'M5 5h6a3 3 0 0 1 0 6H5a3 3 0 0 1 0-6zM11 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  list: 'M3 4h10M3 8h10M3 12h10',
}
</script>

<template>
  <ul class="tutorials" :data-compact="compact || undefined">
    <li v-for="tutorial in TUTORIALS" :key="tutorial.id">
      <button
        type="button"
        class="tutorial"
        :data-tutorial="tutorial.id"
        @click="emit('start', tutorial.id)"
      >
        <span class="icon" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 16 16">
            <path
              :d="ICONS[tutorial.id]"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </span>
        <span class="text">
          <span class="title">
            {{ tutorial.title }}
            <span v-if="completedTutorials.includes(tutorial.id)" class="done" title="Done">✓</span>
          </span>
          <span class="summary">{{ tutorial.summary }}</span>
          <span class="meta">{{ tutorial.minutes }} min · {{ tutorial.steps.length }} steps</span>
        </span>
        <span class="go" aria-hidden="true">Start →</span>
      </button>
    </li>
  </ul>
</template>

<style scoped>
.tutorials {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tutorials[data-compact] {
  grid-template-columns: 1fr;
  gap: 4px;
}
.tutorial {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  width: 100%;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.tutorials[data-compact] .tutorial {
  padding: 10px;
  border-color: transparent;
}
.tutorial:hover {
  border-color: var(--accent);
}
.icon {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: var(--accent-dim);
  color: var(--accent);
}
.text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.title {
  font-weight: 600;
}
.done {
  margin-left: 4px;
  color: var(--ok);
}
.summary {
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 15px;
}
.meta {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.go {
  flex: none;
  color: var(--accent);
  font-size: var(--ui-size-sm);
  font-weight: 600;
}
</style>
