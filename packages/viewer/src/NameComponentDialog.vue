<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { isComponentNameFree } from './layer-moves'

/**
 * Asking what to call a new component (story F10).
 *
 * A dialog rather than a rename-after-the-fact, because the name is *global to
 * the document* (ADR 0004 §2) and a collision has to be a refusal the author
 * sees before the gesture rather than a second patch that fails after it. That
 * is D1 and D2's rule — grey the control out while the pointer is still moving
 * — applied to a name instead of to a selection.
 *
 * `taken` is every name already spoken for, components and token variables
 * alike, since ADR 0004 §2 gives them one namespace.
 */
const props = defineProps<{
  /** The name to start from — the node's own, which is usually most of it. */
  suggested: string
  taken: ReadonlySet<string>
}>()

const emit = defineEmits<{
  confirm: [name: string]
  close: []
}>()

const name = ref(props.suggested)
const input = ref<HTMLInputElement | null>(null)

const free = computed(() => isComponentNameFree(name.value, props.taken))
/**
 * Why it is refused, in the author's terms.
 *
 * Silent while the field is empty: an empty box is not yet a mistake, and a
 * dialog that opens already complaining reads as broken.
 */
const problem = computed<string | null>(() => {
  const wanted = name.value.trim()
  if (wanted === '' || free.value) return null
  if (wanted.includes('#')) return '"#" separates a component from the path inside it'
  return `"${wanted}" is already the name of something in this document`
})

onMounted(() => {
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
})

function confirm(): void {
  if (!free.value) return
  emit('confirm', name.value.trim())
}
</script>

<template>
  <div class="scrim" @click.self="emit('close')">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Make component">
      <label class="field">
        <span class="caption">Component name</span>
        <input
          ref="input"
          v-model="name"
          class="name"
          :data-invalid="problem !== null"
          spellcheck="false"
          @keydown.enter.stop="confirm"
          @keydown.esc.stop="emit('close')"
        />
      </label>
      <!--
        The hint and the refusal share a line, so the dialog does not resize as
        the author types — a box that grows and shrinks under the cursor is
        harder to read than one that swaps its sentence.
      -->
      <p class="hint" :data-problem="problem !== null">
        {{ problem ?? 'Global to the document. Group with “/”, as in Icon/Check.' }}
      </p>
      <div class="actions">
        <button type="button" class="ghost" @click="emit('close')">Cancel</button>
        <button type="button" class="primary" :disabled="!free" @click="confirm">
          Make component
        </button>
      </div>
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
  width: 320px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.caption {
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
.name {
  height: var(--row-h);
  padding: 0 8px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--text);
  font: inherit;
}
.name:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.name[data-invalid='true'] {
  border-color: var(--danger);
}
.hint {
  min-height: 2.4em;
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.hint[data-problem='true'] {
  color: var(--danger);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.actions button {
  height: var(--row-h);
  padding: 0 12px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  font: inherit;
  cursor: pointer;
}
.ghost {
  background: none;
  color: var(--text-dim);
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--text);
}
.primary:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
