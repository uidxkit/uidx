<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { LAYER_ICONS } from './layer-icons'

/**
 * Choosing which component to place (story F11).
 *
 * A picker rather than a tool, because §3.3's creation whitelist is the five
 * things a person *draws* and an `<Instance>` is not one of them: it needs a
 * name, and a name is chosen from a list rather than swept out with a pointer.
 * Picking arms the same draw gesture the five share, so the canvas gains no
 * mode of its own — the next click places one.
 *
 * The list is the document's, not the page's, because ADR 0004 §2 makes a
 * component name global to the whole document.
 */
const props = defineProps<{
  components: readonly string[]
}>()

const emit = defineEmits<{
  pick: [name: string]
  close: []
}>()

const filter = ref('')
const input = ref<HTMLInputElement | null>(null)

const matches = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  const found = needle
    ? props.components.filter((n) => n.toLowerCase().includes(needle))
    : [...props.components]
  return found.sort((a, b) => a.localeCompare(b))
})

onMounted(() => void nextTick(() => input.value?.focus()))

/** Enter takes the only match, which is what a filter box is for. */
function onEnter(): void {
  const only = matches.value[0]
  if (only !== undefined) emit('pick', only)
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Place instance">
      <input
        ref="input"
        v-model="filter"
        class="filter"
        placeholder="Search components"
        aria-label="Search components"
        spellcheck="false"
        @keydown.enter.stop="onEnter"
        @keydown.esc.stop="emit('close')"
      />
      <ul v-if="matches.length" class="list">
        <li v-for="name in matches" :key="name">
          <button type="button" class="entry" @click="emit('pick', name)">
            <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path :d="LAYER_ICONS.Instance" fill="none" stroke="currentColor" />
            </svg>
            {{ name }}
          </button>
        </li>
      </ul>
      <!--
        Two different empty states, because they need two different answers: a
        document with no components at all wants one made, and a filter that
        matches nothing wants clearing.
      -->
      <p v-else class="empty">
        {{
          components.length
            ? 'Nothing matches that.'
            : 'This document declares no components yet. Select something and press ⌘/ctrl+alt+K.'
        }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  background: var(--overlay);
}
.dialog {
  width: 300px;
  max-height: 60vh;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
.filter {
  height: var(--row-h);
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
}
.filter:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.list {
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.entry {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  height: var(--row-h);
  padding: 0 6px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.entry:hover,
.entry:focus-visible {
  background: var(--raised);
  outline: none;
}
.icon {
  flex: none;
  color: var(--bound);
}
.empty {
  margin: 0;
  padding: 4px 6px 8px;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
</style>
