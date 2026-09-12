<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { PROPERTY_TYPES, type JsonValue, type PropertyType } from '@uidx/format'
import { defaultFor } from './component-prop-edits'

/**
 * Declaring or editing one component property, in Figma's own modal.
 *
 * Deliberately dumb: it holds a draft and hands it back, and every refusal
 * belongs to the caller. `declareAndBindProperty` and `renameProperty` are the
 * things that know whether a name is free and whether a value fits its type,
 * and a dialog that guessed at those answers would be a second rulebook to
 * keep in step. So the caller keeps this open when it refuses a submit.
 *
 * The type is never a field. It is fixed by whichever field opened the dialog —
 * `PROPERTY_FIELD` maps each type to exactly one — which is what makes UIDX404
 * unreachable from the UI rather than merely unlikely.
 */
const props = defineProps<{
  mode: 'create' | 'edit'
  /**
   * The type, when the caller fixes it — which a field does, because
   * `PROPERTY_FIELD` maps each type to exactly one field. Null only for the
   * section's own `+`, where nothing has implied a type yet, and then the
   * dialog offers the choice.
   */
  type: PropertyType | null
  /** The name to start from. Empty for a fresh declaration. */
  name?: string
  /** The default to start from — seeded from the literal the field held. */
  value: JsonValue
}>()

const emit = defineEmits<{
  submit: [name: string, value: JsonValue, type: PropertyType]
  close: []
}>()

/** Figma's wording: "Create text property", "Edit boolean property". */
const TYPE_WORD: Record<PropertyType, string> = {
  TEXT: 'text',
  BOOLEAN: 'boolean',
  INSTANCE_SWAP: 'instance swap',
}

const draftType = ref<PropertyType>(props.type ?? 'TEXT')

const title = computed(() => {
  const verb = props.mode === 'create' ? 'Create' : 'Edit'
  // Unnamed when the type is still the author's to pick — "Create text
  // property" would be a claim the dialog has not earned yet.
  return props.type ? `${verb} ${TYPE_WORD[props.type]} property` : `${verb} property`
})

/**
 * A default the chosen type accepts.
 *
 * Switching the type mid-dialog has to move the value with it: `matchesType`
 * refuses a BOOLEAN holding `'Text'`, and a submit that is silently refused is
 * worse than one that never had the wrong value in hand.
 */
function onType(event: Event): void {
  draftType.value = (event.target as HTMLSelectElement).value as PropertyType
  draftValue.value = defaultFor(draftType.value)
}

const draftName = ref(props.name ?? '')
// `shallowRef`, not `ref`: `JsonValue` is recursive, and deep unwrapping it
// is a type instantiation TypeScript gives up on. Nothing here mutates the
// value in place anyway — every edit replaces it.
const draftValue = shallowRef<JsonValue>(props.value)

const asText = computed(() => (draftValue.value === null ? '' : String(draftValue.value)))
const asBool = computed(() => draftValue.value === true)

function onText(event: Event): void {
  draftValue.value = (event.target as HTMLInputElement).value
}

function onBool(event: Event): void {
  draftValue.value = (event.target as HTMLInputElement).checked
}
</script>

<template>
  <div class="property-dialog" role="dialog" :aria-label="title">
    <form @submit.prevent="emit('submit', draftName, draftValue, draftType)">
      <header class="dialog-head">
        <h3>{{ title }}</h3>
        <button type="button" class="dialog-close" aria-label="Close" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="dialog-row">
        <label :for="'prop-name'">Name</label>
        <input id="prop-name" v-model="draftName" class="name-input" autocomplete="off" />
      </div>

      <div v-if="!type" class="dialog-row">
        <label :for="'prop-type'">Type</label>
        <select id="prop-type" class="type-input" :value="draftType" @change="onType">
          <option v-for="option in PROPERTY_TYPES" :key="option" :value="option">
            {{ TYPE_WORD[option] }}
          </option>
        </select>
      </div>

      <div class="dialog-row">
        <label :for="'prop-value'">Value</label>
        <!--
          A boolean's default reads as a switch with the word beside it, the way
          Figma's does — the word is what makes a half-lit toggle unambiguous in
          a screenshot or a review.
        -->
        <template v-if="draftType === 'BOOLEAN'">
          <input
            id="prop-value"
            type="checkbox"
            class="value-input bool"
            :checked="asBool"
            @change="onBool"
          />
          <span class="bool-word">{{ asBool ? 'True' : 'False' }}</span>
        </template>
        <input
          v-else
          id="prop-value"
          class="value-input"
          :value="asText"
          autocomplete="off"
          @input="onText"
        />
      </div>

      <footer class="dialog-foot">
        <button type="button" class="dialog-cancel" @click="emit('close')">Cancel</button>
        <button type="submit" class="dialog-confirm">
          {{ mode === 'create' ? 'Create property' : 'Save' }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.property-dialog {
  /* Fixed, not absolute: absolutely positioned it sat at its static position
     in the pane's scroll content — after every section — which put it
     hundreds of pixels below the fold on a full panel, so opening it
     appeared to do nothing. The pane is the shell's rightmost rail hugging
     the viewport edge, so the viewport places this over the pane's visible
     box without knowing the scroll position. */
  position: fixed;
  top: 96px;
  /* Spans the panel rather than taking a fixed width: the inspector is
     narrower than a comfortable modal, and a 260px box overflowed it and cut
     its own title off the left edge. */
  right: var(--pad);
  width: calc(var(--rail-w) - 2 * var(--pad));
  z-index: 20;
  padding: var(--pad);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
}
.dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
h3 {
  margin: 0;
  font-size: var(--ui-size);
  font-weight: 600;
}
.dialog-close,
.dialog-cancel,
.dialog-confirm {
  border: 0;
  background: none;
  color: inherit;
  cursor: pointer;
}
.dialog-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.dialog-row label {
  flex: none;
  width: 40px;
  color: var(--text-faint);
  font-size: var(--ui-size);
}
.name-input,
.type-input,
.value-input:not(.bool) {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--raised);
  color: inherit;
  font: inherit;
}
.name-input:focus,
.value-input:focus {
  border-color: var(--accent);
  outline: none;
}
.bool-word {
  color: var(--text-faint);
  font-size: var(--ui-size);
}
.dialog-foot {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 12px;
}
.dialog-confirm {
  padding: 3px 10px;
  border-radius: 4px;
  background: var(--accent);
  color: #fff;
}
.dialog-cancel {
  padding: 3px 8px;
  color: var(--text-faint);
}
</style>
