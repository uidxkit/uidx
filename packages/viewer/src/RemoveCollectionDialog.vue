<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { DeleteCollectionPlan } from '@uidx/schema'

const props = defineProps<{
  name: string
  tokens: readonly string[]
  plan: DeleteCollectionPlan | null
  blocked: string | null
}>()
const emit = defineEmits<{ confirm: []; close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)
const referenceCount = computed(() => props.plan?.dependents.length ?? 0)
let trigger: HTMLElement | null = null

onMounted(() => {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  dialog.value?.showModal()
})
onUnmounted(() => {
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
})

function confirm(): void {
  if (props.plan && !props.blocked) emit('confirm')
}
</script>

<template>
  <dialog
    ref="dialog"
    aria-labelledby="remove-collection-title"
    aria-describedby="remove-collection-description"
    @cancel.prevent="emit('close')"
    @click.self="emit('close')"
    @keydown.stop
  >
    <section class="content">
      <h2 id="remove-collection-title">Remove collection?</h2>
      <p id="remove-collection-description">
        <template v-if="tokens.length">
          This removes <strong>{{ name }}</strong> and all {{ tokens.length }}
          {{ tokens.length === 1 ? 'token' : 'tokens' }} inside it.
        </template>
        <template v-else
          >This removes the empty collection <strong>{{ name }}</strong
          >.</template
        >
      </p>
      <details v-if="tokens.length" class="tokens">
        <summary>
          Tokens to remove <span>{{ tokens.length }}</span>
        </summary>
        <ul>
          <li v-for="address in tokens" :key="address">
            {{ address.split('#').slice(1).join('#') }}
          </li>
        </ul>
      </details>
      <p v-if="referenceCount" class="impact">
        {{ referenceCount }} {{ referenceCount === 1 ? 'reference will' : 'references will' }}
        use resolved values instead of tokens. Values that depend on modes become fixed.
      </p>
      <p v-if="plan?.modeOverrides" class="impact">
        Mode selections for this collection will also be cleared.
      </p>
      <p v-if="blocked" class="problem" role="alert">{{ blocked }}</p>
      <footer>
        <button type="button" autofocus @click="emit('close')">Cancel</button>
        <button type="button" class="danger" :disabled="!plan || !!blocked" @click="confirm">
          Remove collection
        </button>
      </footer>
    </section>
  </dialog>
</template>

<style scoped>
dialog {
  width: 380px;
  max-width: calc(100vw - 40px);
  max-height: calc(100dvh - 48px);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow);
  overscroll-behavior: contain;
}
dialog::backdrop {
  background: var(--overlay);
}
.content {
  padding: 20px;
}
h2 {
  margin: 0 0 10px;
  font-size: 14px;
  font-weight: 600;
}
p {
  margin: 0 0 14px;
  color: var(--text-dim);
  line-height: 1.6;
  font-size: 12px;
  overflow-wrap: anywhere;
}
strong {
  color: var(--text);
  font-weight: 500;
}
.tokens {
  margin-bottom: 14px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  font-size: 11px;
}
summary {
  cursor: pointer;
  color: var(--text-dim);
}
summary span {
  float: right;
  color: var(--text-faint);
}
ul {
  max-height: 150px;
  overflow: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  color: var(--text-dim);
}
li {
  padding: 3px 0;
  overflow-wrap: anywhere;
}
.impact {
  font-size: 11px;
}
.problem {
  color: var(--danger);
  font-size: 11px;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
button {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
button:hover {
  background: var(--hover);
}
.danger {
  background: color-mix(in srgb, var(--danger) 10%, var(--panel));
  border-color: color-mix(in srgb, var(--danger) 30%, var(--line));
  color: var(--danger);
}
.danger:hover {
  background: color-mix(in srgb, var(--danger) 18%, var(--panel));
}
button:disabled {
  cursor: default;
  opacity: 0.4;
}
button:focus-visible,
summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
