<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'

/**
 * Keeps one failing pane from taking the window with it (spec §11).
 *
 * The canvas calls into a 0.x SDK and a WASM renderer, so it is by far the most
 * likely thing here to throw. When it does, the intent pane still holds the
 * component's rules and the contract pane still shows its properties — losing
 * those as well turns a rendering problem into a blank page, which is the one
 * outcome §11 rules out.
 */
const props = defineProps<{ pane: string }>()

const error = ref<Error | null>(null)

onErrorCaptured((caught) => {
  error.value = caught instanceof Error ? caught : new Error(String(caught))
  // Stop propagation: handled here, and letting it climb would defeat the point.
  return false
})

function retry(): void {
  error.value = null
}
</script>

<template>
  <slot v-if="!error" />
  <div v-else class="boundary" role="alert">
    <h3>{{ props.pane }} failed to render</h3>
    <p class="message">{{ error.message }}</p>
    <p class="hint">
      The other panes are unaffected. A valid save will not fix this on its own — use retry, or
      reload if it persists.
    </p>
    <button type="button" @click="retry">Retry</button>
    <details v-if="error.stack">
      <summary>stack</summary>
      <pre>{{ error.stack }}</pre>
    </details>
  </div>
</template>

<style scoped>
.boundary {
  height: 100%;
  overflow: auto;
  padding: 20px;
  background: var(--canvas-bg);
  color: var(--danger);
  font-family: var(--ui-font);
  font-size: 12px;
}
h3 {
  margin: 0 0 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.message {
  color: var(--text);
  word-break: break-word;
  margin: 0 0 10px;
}
.hint {
  color: var(--text-faint);
  margin: 0 0 14px;
  line-height: 1.5;
}
button {
  background: var(--panel);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 5px 12px;
  cursor: pointer;
  font: inherit;
}
/* The hover has to read as a change; `--line` is the resting border. */
button:hover {
  border-color: var(--text-faint);
}
details {
  margin-top: 14px;
  color: var(--text-faint);
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
}
</style>
