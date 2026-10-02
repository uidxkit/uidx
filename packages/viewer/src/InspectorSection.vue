<script setup lang="ts">
import { ref, useId } from 'vue'

import { FieldIcon } from './field-icons'

/**
 * The one section of the Contract, Connect and Code tabs: the Design tab's
 * full-bleed section (a 44px head, the title, a faint meta, a right-hand
 * cluster) as a component, so the three tabs cannot each grow their own
 * header. Teaching copy lives behind the (i), not in the body: it is read
 * once and then only takes room.
 *
 * Collapsible sections are a `<details>`, whose `open` is the initial state
 * and whose `toggle` reports the reader's choice; the head's buttons stop
 * their click from toggling it.
 */
const props = defineProps<{
  title: string
  /** A faint note after the title: a count, 'of Button', a value. Ellipsised. */
  meta?: string
  /** The meta's title, when the visible meta is shortened. */
  metaTitle?: string
  /** What the section is for; on the (i) button's title and expanded inline on click. */
  info?: string
  collapsible?: boolean
  /** Whether a collapsible section starts open. */
  open?: boolean
  /** `data-field` on the root, for tests and focus targets. */
  field?: string
  /** `data-group` on the root. */
  group?: string
  /** `aria-label` on the root. */
  label?: string
}>()

const emit = defineEmits<{ toggle: [open: boolean] }>()

const tip = ref(false)
const tipId = useId()

function onToggle(event: Event): void {
  emit('toggle', (event.target as HTMLDetailsElement).open)
}
</script>

<template>
  <details
    v-if="props.collapsible"
    class="section"
    :data-field="field"
    :data-group="group"
    :aria-label="label"
    :open="open"
    @toggle="onToggle"
  >
    <summary class="section-head head">
      <span class="section-title title">{{ title }}</span>
      <span v-if="meta" class="section-meta" :title="metaTitle ?? meta">{{ meta }}</span>
      <span class="grow" />
      <span class="section-actions" @click.prevent><slot name="actions" /></span>
      <button
        v-if="info"
        type="button"
        class="cluster-btn info-tip"
        :aria-label="`About ${title}`"
        :aria-expanded="tip"
        :aria-controls="tip ? tipId : undefined"
        :title="info"
        @click.prevent="tip = !tip"
      >
        <FieldIcon name="info" />
      </button>
      <span class="chevron" aria-hidden="true">›</span>
    </summary>
    <p v-if="tip" :id="tipId" class="section-tip">{{ info }}</p>
    <div class="section-body"><slot /></div>
  </details>
  <section v-else class="section" :data-field="field" :data-group="group" :aria-label="label">
    <header class="section-head head">
      <span class="section-title title">{{ title }}</span>
      <span v-if="meta" class="section-meta" :title="metaTitle ?? meta">{{ meta }}</span>
      <span class="grow" />
      <span class="section-actions"><slot name="actions" /></span>
      <button
        v-if="info"
        type="button"
        class="cluster-btn info-tip"
        :aria-label="`About ${title}`"
        :aria-expanded="tip"
        :aria-controls="tip ? tipId : undefined"
        :title="info"
        @click="tip = !tip"
      >
        <FieldIcon name="info" />
      </button>
    </header>
    <p v-if="tip" :id="tipId" class="section-tip">{{ info }}</p>
    <div class="section-body"><slot /></div>
  </section>
</template>

<style scoped>
.section {
  /* Full-bleed separators, as the Design tab's sections: the margins undo
     the pane's own gutter, the padding restores it inside. */
  margin: 0 calc(-1 * var(--section-pad));
  padding: 0 var(--section-pad);
  border-bottom: 1px solid var(--line);
  min-width: 0;
}
summary.section-head {
  list-style: none;
  cursor: pointer;
  user-select: none;
}
summary.section-head::-webkit-details-marker {
  display: none;
}
.section-head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  min-width: 0;
}
.section-title {
  flex: none;
  font-size: var(--ui-size);
  font-weight: 600;
  color: var(--text);
}
.section-meta {
  margin-left: 6px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.grow {
  flex: 1 1 0;
  min-width: 4px;
}
.section-actions {
  display: flex;
  flex: none;
  align-items: center;
  gap: 2px;
}
.section-actions:empty {
  display: none;
}
.section-actions :deep(.link-button) {
  font-size: var(--ui-size-sm);
  font-weight: 500;
  white-space: nowrap;
}
.chevron {
  flex: none;
  width: 24px;
  text-align: center;
  color: var(--text-faint);
  transition: transform 0.1s;
}
details[open] > summary .chevron {
  transform: rotate(90deg);
}
.section-tip {
  margin: -6px 0 10px;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.section-body {
  padding-bottom: 12px;
  min-width: 0;
}
/* A closed section is its head; an open one with an empty body adds nothing. */
.section-body:empty {
  padding-bottom: 0;
}
</style>
