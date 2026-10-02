<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue'

type Kind = 'page' | 'component' | 'tokens'
const props = defineProps<{ kind?: Kind }>()
const emit = defineEmits<{ created: [file: string]; close: [] }>()
const KINDS: { id: Kind; label: string; hint: string; name: string }[] = [
  { id: 'page', label: 'Page', hint: 'A blank canvas for screens and layouts.', name: 'Untitled' },
  {
    id: 'component',
    label: 'Component',
    hint: 'One component with a starter contract: a label property you can rename, and states to add.',
    name: 'Button',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    hint: 'The colours, spacing and type every component references.',
    name: 'Tokens',
  },
]
const kind = ref<Kind>(props.kind ?? 'page')
const name = ref(KINDS.find((entry) => entry.id === kind.value)!.name)
function choose(next: Kind): void {
  // Keep a name the user typed; swap only the suggestion.
  if (KINDS.some((entry) => entry.name === name.value))
    name.value = KINDS.find((entry) => entry.id === next)!.name
  kind.value = next
}
const pending = ref(false)
const error = ref<string | null>(null)
const input = ref<HTMLInputElement | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
const previousFocus = document.activeElement

onMounted(() => {
  dialog.value?.showModal?.()
  void nextTick(() => {
    input.value?.focus()
    input.value?.select()
  })
})
onUnmounted(() => {
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
})

async function create(): Promise<void> {
  if (pending.value || !name.value.trim()) return
  pending.value = true
  error.value = null
  try {
    const response = await fetch('/__uidx/pages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.value.trim(), kind: kind.value }),
      signal: AbortSignal.timeout(15000),
    })
    const body = (await response.json()) as { file?: string; error?: string }
    if (!response.ok || !body.file) throw new Error(body.error ?? 'Could not create the page.')
    emit('created', body.file)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not reach the server. Try again.'
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <dialog ref="dialog" aria-labelledby="new-page-title" @cancel.prevent="!pending && emit('close')">
    <form @submit.prevent="create">
      <h2 id="new-page-title">New file</h2>
      <div class="kinds" role="radiogroup" aria-label="What to create">
        <button
          v-for="entry in KINDS"
          :key="entry.id"
          type="button"
          role="radio"
          :aria-checked="kind === entry.id"
          :data-kind="entry.id"
          :disabled="pending"
          @click="choose(entry.id)"
        >
          {{ entry.label }}
        </button>
      </div>
      <label for="new-page-name">Name</label>
      <input
        id="new-page-name"
        ref="input"
        v-model="name"
        maxlength="100"
        :disabled="pending"
        required
        aria-describedby="new-page-hint"
      />
      <p id="new-page-hint">
        {{ KINDS.find((entry) => entry.id === kind)!.hint }} Saved in your project’s design folder.
      </p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <div class="actions">
        <button type="button" :disabled="pending" @click="emit('close')">Cancel</button>
        <button class="primary" type="submit" :disabled="pending || !name.trim()">
          {{ pending ? 'Creating…' : `Create ${kind === 'tokens' ? 'tokens' : kind}` }}
        </button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
dialog {
  width: min(360px, calc(100vw - 48px));
  padding: 20px;
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow);
}
dialog::backdrop {
  background: var(--overlay);
}
form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h2 {
  margin: 0 0 6px;
  font-size: 16px;
}
label {
  color: var(--text-dim);
}
input,
button {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font: inherit;
  color: inherit;
}
input {
  background: var(--bg);
  height: 32px;
  padding: 0 8px;
}
input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
p {
  margin: 0;
  color: var(--text-faint);
}
.error {
  color: var(--danger);
}
.kinds {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}
.kinds [aria-checked='true'] {
  border-color: var(--accent);
  color: var(--text);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
button {
  background: none;
  min-height: 30px;
  padding: 0 12px;
  cursor: pointer;
}
.primary {
  background: var(--accent);
  border-color: var(--accent);
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
