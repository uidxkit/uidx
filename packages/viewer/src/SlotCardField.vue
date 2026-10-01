<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UidxNode, UidxPatch } from '@uidx/format'
import ComponentThumb from './ComponentThumb.vue'
import SlotContentPopup from './SlotContentPopup.vue'
import { pickPatches, type SlotCard, type SlotPick } from './slot-content'

/**
 * One slot of an instance, as a card: what fills it, chosen from a picker
 * (the injection gesture of ADR 0007 and ADR 0017 §2), with what the slot
 * does — repeat over a list — said on the card rather than discovered on the
 * canvas. Shown for the instance, and for the fill when that is selected.
 */
const props = defineProps<{ card: SlotCard; instance: UidxNode; writable: boolean }>()
const emit = defineEmits<{ patches: [patches: UidxPatch[]]; select: [address: string] }>()

const open = ref(false)
const trigger = ref<Element | null>(null)
function setTrigger(element: unknown): void {
  trigger.value = element instanceof Element ? element : null
}

function pick(choice: SlotPick): void {
  if (!props.writable) return
  const patches = pickPatches(props.instance, props.card, choice)
  if (patches.length) emit('patches', patches)
}

/** The layer that fills the slot, for the select button; null for the default or nothing. */
const contentAddress = computed(() =>
  'address' in props.card.content ? props.card.content.address : null,
)
</script>

<template>
  <div class="slot-card" :data-slot="card.name" :data-content="card.content.kind">
    <div class="slot-head">
      <span class="slot-name">{{ card.name }}</span>
      <span
        v-if="card.repeat"
        class="repeat-badge"
        :title="`Drawn once per item of ${card.repeat.list}`"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2 5a4 4 0 0 1 7-2.5M10 7a4 4 0 0 1-7 2.5M9 1v2H7M3 11V9h2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
          />
        </svg>
        Repeats for each of {{ card.repeat.list }}
      </span>
    </div>
    <div class="slot-row">
      <button
        :ref="(element) => setTrigger(element)"
        type="button"
        class="slot-trigger"
        data-popup-trigger
        :disabled="!writable"
        :aria-expanded="open"
        :aria-label="`Content of ${card.name}: ${card.content.label}`"
        @click="open = !open"
      >
        <ComponentThumb
          v-if="card.content.kind === 'component' || card.content.kind === 'default'"
          size="sm"
          :name="
            card.content.kind === 'component'
              ? card.content.component
              : (card.fallback.component ?? '')
          "
        />
        <span v-else class="slot-glyph" aria-hidden="true">{{
          card.content.kind === 'text' ? 'T' : card.content.kind === 'empty' ? '∅' : '≡'
        }}</span>
        <span class="slot-label">{{ card.content.label }}</span>
        <span v-if="card.content.kind === 'default'" class="default-tag">Default</span>
        <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button
        v-if="contentAddress"
        type="button"
        class="icon-button"
        :title="`Select what fills ${card.name}`"
        :aria-label="`Select content of ${card.name}`"
        @click="emit('select', contentAddress!)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path
            d="M2.5 2.5l3 7 1-3 3-1z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.2"
            stroke-linejoin="round"
          />
        </svg>
      </button>
      <button
        v-if="card.fill"
        type="button"
        class="icon-button"
        :disabled="!writable"
        :aria-label="`Reset slot ${card.name}`"
        :title="`Back to the default — ${card.fallback.label}`"
        @click="pick({ kind: 'default' })"
      >
        ↺
      </button>
    </div>
    <p v-if="card.warning" class="slot-warning" role="status">{{ card.warning }}</p>
    <SlotContentPopup
      v-if="open"
      :card="card"
      :trigger="trigger"
      @pick="pick($event)"
      @close="open = false"
    />
  </div>
</template>

<style scoped>
.slot-card {
  margin-bottom: var(--gap);
}
.slot-head {
  display: flex;
  gap: var(--gap-sm);
  align-items: center;
  justify-content: space-between;
  height: 20px;
}
.slot-name {
  color: var(--text-dim);
}
.repeat-badge {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  color: var(--bound);
  font-size: var(--ui-size-sm);
}
.slot-row {
  display: flex;
  gap: 2px;
  align-items: center;
}
.slot-trigger {
  display: flex;
  flex: 1;
  gap: var(--gap);
  align-items: center;
  min-width: 0;
  height: 32px;
  padding: 0 6px 0 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.slot-trigger:hover:not(:disabled),
.slot-trigger[aria-expanded='true'] {
  border-color: var(--accent);
}
.slot-glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 22px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
}
.slot-label {
  flex: 1;
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-card[data-content='empty'] .slot-label,
.slot-card[data-content='default'] .slot-label {
  color: var(--text-dim);
  font-weight: 400;
}
.default-tag {
  padding: 0 5px;
  border-radius: 8px;
  background: var(--panel);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.chevron {
  flex: none;
  color: var(--text-faint);
}
.slot-warning {
  margin: 4px 0 0;
  color: var(--warn);
  font-size: var(--ui-size-sm);
  line-height: 14px;
}
.icon-button {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--field-h);
  height: var(--field-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius-lg);
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
</style>
