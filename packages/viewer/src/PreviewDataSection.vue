<script setup lang="ts">
import { computed } from 'vue'
import type { UidxNode } from '@uidx/format'
import type { ModelIndex } from '@uidx/schema'
import { previewModel, sampleCount, sampleLabel } from './instance-data'

/**
 * Which sample an item component is drawn with (ADR 0015 §2), on its own
 * page: Storybook's args, Builder's preview data. A component that receives
 * a `Person` is designed against one person at a time, and stepping through
 * the samples is how a designer sees the long name wrap and the empty role
 * collapse — without writing anything, since previewing is not designing.
 */
const props = defineProps<{
  component: UidxNode
  models?: ModelIndex
  index: number
}>()
const emit = defineEmits<{ preview: [index: number]; openModel: [name: string] }>()

const found = computed(() => previewModel(props.component, props.models))
const count = computed(() => (found.value ? sampleCount(found.value.model) : 0))
const at = computed(() => (count.value ? props.index % count.value : 0))
const label = computed(() => (found.value ? sampleLabel(found.value.model, at.value) : ''))
const step = (by: number): void => emit('preview', (at.value + by + count.value) % count.value)
</script>

<template>
  <section v-if="found" class="preview-data" aria-label="Preview data">
    <header class="head">
      <span class="title">Preview data</span>
      <button
        type="button"
        class="model"
        :title="`Open the ${found.model.name} model`"
        @click="emit('openModel', found.model.name)"
      >
        {{ found.model.name }}
      </button>
    </header>
    <div class="row">
      <span class="name">{{ found.prop }}</span>
      <span class="stepper" role="group" :aria-label="`Preview ${found.prop}`">
        <button
          type="button"
          class="step"
          :aria-label="`Previous ${found.prop}`"
          :disabled="count < 2"
          @click="step(-1)"
        >
          ‹
        </button>
        <span class="label">{{ label }}</span>
        <span class="count">{{ at + 1 }}/{{ count }}</span>
        <button
          type="button"
          class="step"
          :aria-label="`Next ${found.prop}`"
          :disabled="count < 2"
          @click="step(1)"
        >
          ›
        </button>
      </span>
    </div>
    <p class="hint">Only the canvas changes — a list hands each row its own item.</p>
  </section>
</template>

<style scoped>
.preview-data {
  padding: 0 0 var(--pad);
  margin-bottom: var(--pad);
  border-bottom: 1px solid var(--line);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--row-h);
}
.title {
  color: var(--text);
  font-weight: 600;
}
.model {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: none;
  color: var(--bound);
  font: inherit;
  font-size: var(--ui-size-sm);
  line-height: 18px;
  cursor: pointer;
}
.model:hover {
  border-color: var(--bound);
}
.row {
  display: grid;
  grid-template-columns: 72px 1fr;
  align-items: center;
  gap: var(--gap-sm);
}
.name {
  color: var(--text-dim);
}
.stepper {
  display: flex;
  align-items: center;
  min-width: 0;
  height: var(--field-h);
  border-radius: var(--radius-lg);
  background: var(--raised);
}
.step {
  flex: none;
  width: 24px;
  height: var(--field-h);
  padding: 0;
  border: 0;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
.step:hover:not(:disabled) {
  color: var(--text);
}
.label {
  flex: 1;
  overflow: hidden;
  color: var(--text);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.count {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  font-variant-numeric: tabular-nums;
}
.hint {
  margin: var(--gap-sm) 0 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
</style>
