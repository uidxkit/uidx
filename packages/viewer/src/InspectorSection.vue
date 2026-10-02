<script setup lang="ts">
import { ref, useId, watch } from 'vue'

import { FieldIcon } from './field-icons'

/**
 * The one section of the Contract, Connect and Code tabs: the Design tab's
 * full-bleed section (a 44px head, the title, a faint meta, a right-hand
 * cluster) as a component, so the three tabs cannot each grow their own
 * header. Teaching copy lives behind the (i), not in the body: it is read
 * once and then only takes room.
 *
 * A collapsible section is a disclosure, as the Design tab's are: the title
 * and meta are its toggle button, and the head's other buttons sit beside
 * it rather than inside it, so each is its own control to a screen reader
 * and none of them folds the section. The (i)'s tip shows under the head
 * whether the section is open or not. The (i) is always last, at the right
 * edge, so it sits in one column down the tab; a chevron goes before it.
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
  /** Whether a collapsible section is open: where it starts, and where the tab moves it. */
  open?: boolean
  /** `data-field` on the root, for tests and focus targets. */
  field?: string
  /** `data-group` on the root. */
  group?: string
  /** `aria-label` on the root. */
  label?: string
}>()

/** The reader's choice; `show()` reports through it too. */
const emit = defineEmits<{ toggle: [open: boolean] }>()

const tip = ref(false)
const tipId = useId()
const bodyId = useId()

/** A change of `open` moves the section; between changes, the reader's choice stands. */
const isOpen = ref(!!props.open)
watch(
  () => props.open,
  (open) => {
    isOpen.value = !!open
  },
)

function toggle(): void {
  isOpen.value = !isOpen.value
  emit('toggle', isOpen.value)
}

/**
 * Opens the section for the tab, also after the reader closed it, when the
 * `open` prop alone would not move: a request to show what is inside.
 */
function show(): void {
  if (isOpen.value) return
  isOpen.value = true
  emit('toggle', true)
}

defineExpose({ show })
</script>

<template>
  <section class="section" :data-field="field" :data-group="group" :aria-label="label">
    <div class="section-head head">
      <button
        v-if="props.collapsible"
        type="button"
        class="section-toggle"
        :aria-expanded="isOpen"
        :aria-controls="bodyId"
        @click="toggle"
      >
        <span class="section-title title">{{ title }}</span>
        <span v-if="meta" class="section-meta" :title="metaTitle ?? meta">{{ meta }}</span>
      </button>
      <template v-else>
        <span class="section-title title">{{ title }}</span>
        <span v-if="meta" class="section-meta" :title="metaTitle ?? meta">{{ meta }}</span>
        <span class="grow" />
      </template>
      <span class="section-actions"><slot name="actions" /></span>
      <!-- The toggle's own arrow, so it folds too; the button is the keyboard's way. -->
      <span v-if="props.collapsible" class="chevron" aria-hidden="true" @click="toggle">›</span>
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
    </div>
    <p v-if="tip" :id="tipId" class="section-tip">{{ info }}</p>
    <div
      v-show="!props.collapsible || isOpen"
      :id="props.collapsible ? bodyId : undefined"
      class="section-body"
    >
      <slot />
    </div>
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
.section-head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  min-width: 0;
}
/* The head left of its buttons, as the Design tab's toggle is. The head has
   no side padding (the gutter is the section's), so the toggle reaches 6px
   into the gutter and pads it back: the pane's inset focus ring then clears
   the title's first glyph, and, 6px short of the head's edges, a tip below. */
.section-toggle {
  display: flex;
  flex: 1 1 0;
  align-self: stretch;
  align-items: center;
  min-width: 0;
  margin: 6px 0 6px -6px;
  padding: 0 0 0 6px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  user-select: none;
}
.section-head .section-toggle:focus-visible {
  border-radius: var(--radius);
}
.section-title {
  flex: none;
  font-size: var(--ui-size);
  font-weight: 600;
  color: var(--text);
}
/* The meta gives way first: it is a note, and the title already names the
   section. It takes only the room the title and actions leave (no basis of
   its own), so an action beside it never loses a fraction of a pixel to it
   and ellipsises; an action only shrinks once there is no meta left. */
.section-meta {
  flex: 1000 1 0;
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
  flex: 0 1 auto;
  align-items: center;
  gap: 2px;
  min-width: 0;
}
.section-actions:empty {
  display: none;
}
/* A text action carries a name; a long one ellipsises rather than run off the pane. */
.section-actions :deep(.link-button) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--ui-size-sm);
  font-weight: 500;
}
.chevron {
  flex: none;
  width: 24px;
  text-align: center;
  color: var(--text-faint);
  cursor: pointer;
  transition: transform 0.1s;
}
.section-toggle[aria-expanded='true'] ~ .chevron {
  transform: rotate(90deg);
}
/* A long component name in the text is one word; it breaks rather than
   scroll the pane. */
.section-tip {
  margin: -6px 0 10px;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
  overflow-wrap: anywhere;
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
