<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ConnectionState } from './socket'
import { setTheme, theme } from './theme'

/**
 * The bar across the top of the editor: where you are (document › page),
 * which face of it you are looking at, and the session's controls — undo,
 * save state, theme, the assistant and the code the design produces. One
 * bar on every view, so the editor reads as one application rather than a
 * set of panels.
 */
type Face = 'page' | 'docs' | 'tokens' | 'fonts' | 'models'

const props = defineProps<{
  title: string
  page?: string | null
  view: 'home' | Face
  renderable: boolean
  connection: ConnectionState
  saving?: boolean
  saved?: boolean
  canUndo: boolean
  canRedo: boolean
  /** Whether `uidx.json` names where generated code goes. */
  codeOut: string | null
  codeRunning: boolean
  codeNotice: string
  /** The assistant is reachable; its button shows only then. */
  agentOnline: boolean
  agentOpen: boolean
}>()

const emit = defineEmits<{
  home: []
  face: [view: Face]
  undo: []
  redo: []
  code: []
  agent: []
}>()

const FACES: { id: Face; label: string; icon: string }[] = [
  {
    id: 'page',
    label: 'Design',
    icon: 'M2.5 2.5h11v11h-11zM2.5 6h11M6 6v7.5',
  },
  {
    id: 'docs',
    label: 'Docs',
    icon: 'M3 2.5h7.5L13 5v8.5H3zM10.5 2.5V5H13M5.5 8h5M5.5 10.5h5',
  },
  {
    id: 'tokens',
    label: 'Tokens',
    icon: 'M8 2a6 6 0 1 0 0 12c.8 0 1.2-.6 1.2-1.2 0-.9-.8-1.1-.8-1.9 0-.6.5-1 1.1-1H11a3 3 0 0 0 3-3C14 4.3 11.3 2 8 2zM5 7.5h.01M7.5 5h.01M10.5 5.5h.01',
  },
  {
    id: 'fonts',
    label: 'Fonts',
    icon: 'M3 13l4-10 4 10M4.5 9.5h5M12 13V8.5M12 10.5a1.75 1.75 0 1 0 0 0',
  },
  {
    id: 'models',
    label: 'Models',
    icon: 'M2.5 4c0-1 2.5-1.75 5.5-1.75S13.5 3 13.5 4s-2.5 1.75-5.5 1.75S2.5 5 2.5 4zM2.5 4v8c0 1 2.5 1.75 5.5 1.75s5.5-.75 5.5-1.75V4M2.5 8c0 1 2.5 1.75 5.5 1.75S13.5 9 13.5 8',
  },
]

const status = computed(() => {
  if (props.connection === 'reconnecting') return { text: 'Reconnecting…', state: 'warn' }
  if (props.connection === 'connecting') return { text: 'Connecting…', state: 'warn' }
  if (props.connection === 'closed') return { text: 'Offline', state: 'bad' }
  if (props.saving) return { text: 'Saving…', state: 'busy' }
  if (props.saved) return { text: 'Saved', state: 'ok' }
  return { text: 'Connected', state: 'ok' }
})

const showCode = ref(false)
function code(): void {
  showCode.value = true
  if (props.codeOut) emit('code')
}
</script>

<template>
  <header class="app-bar">
    <div class="start">
      <button
        type="button"
        class="brand"
        :aria-label="view === 'home' ? 'uidx' : 'Document overview'"
        title="Document overview"
        @click="emit('home')"
      >
        <svg viewBox="0 0 48 24" width="40" height="20" aria-hidden="true">
          <g
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M3 8v7a3.5 3.5 0 0 0 7 0V8M16 8v10M28 3v15h-3.5a5 5 0 0 1 0-10H28M35 8l9 10M44 8l-9 10"
            />
          </g>
          <circle cx="16" cy="3.5" r="1.3" fill="currentColor" />
        </svg>
      </button>
      <nav class="crumbs" aria-label="Location">
        <button
          type="button"
          class="crumb"
          :class="{ current: view === 'home' }"
          :title="title"
          @click="emit('home')"
        >
          {{ title }}
        </button>
        <template v-if="page && view !== 'home'">
          <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
          <span class="crumb current" :title="page">{{ page }}</span>
        </template>
      </nav>
    </div>

    <nav v-if="view !== 'home'" class="faces" aria-label="View">
      <button
        v-for="face in FACES"
        :key="face.id"
        type="button"
        class="face"
        :data-face="face.id"
        :aria-pressed="view === face.id"
        :disabled="face.id === 'page' && !renderable"
        :title="
          face.id === 'page' && !renderable ? 'This page holds tokens, not a canvas' : face.label
        "
        @click="emit('face', face.id)"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            :d="face.icon"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <span>{{ face.label }}</span>
      </button>
    </nav>

    <span v-if="view === 'home'" aria-hidden="true" />

    <div class="end">
      <div class="history" role="group" aria-label="History">
        <button
          type="button"
          class="icon-button"
          :disabled="!canUndo"
          aria-label="Undo"
          title="Undo (⌘Z)"
          @click="emit('undo')"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5.5 3.5 2.5 6.5l3 3M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
        <button
          type="button"
          class="icon-button"
          :disabled="!canRedo"
          aria-label="Redo"
          title="Redo (⇧⌘Z)"
          @click="emit('redo')"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M10.5 3.5l3 3-3 3M13.5 6.5h-7a3.5 3.5 0 0 0 0 7H9"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>

      <span class="status" :data-state="status.state" role="status" :title="status.text">
        <span class="dot" aria-hidden="true" />{{ status.text }}
      </span>

      <button
        type="button"
        class="icon-button"
        :aria-label="theme === 'dark' ? 'Use light theme' : 'Use dark theme'"
        :title="theme === 'dark' ? 'Light theme' : 'Dark theme'"
        data-action="theme"
        @click="setTheme(theme === 'dark' ? 'light' : 'dark')"
      >
        <svg v-if="theme === 'dark'" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="1.4" />
          <path
            d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linecap="round"
          />
        </svg>
        <svg v-else width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <button
        v-if="agentOnline"
        type="button"
        class="secondary"
        :aria-pressed="agentOpen"
        data-action="agent"
        @click="emit('agent')"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5l-1.6-4.4L2 7.5l4.4-1.6z"
            fill="none"
            stroke="currentColor"
            stroke-width="1.3"
            stroke-linejoin="round"
          />
        </svg>
        Ask AI
      </button>

      <div class="code">
        <button
          type="button"
          class="primary"
          data-action="code"
          :disabled="codeRunning || connection !== 'open'"
          :title="codeOut ? `Generate code into ${codeOut}` : 'Generate code from the design'"
          @click="code"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          {{ codeRunning ? 'Generating…' : 'Get code' }}
        </button>
        <div v-if="showCode" class="popover" role="dialog" aria-label="Generated code">
          <template v-if="codeOut">
            <strong>{{ codeRunning ? 'Generating…' : 'Code' }}</strong>
            <p>
              {{
                codeNotice ||
                `Writes the headless elements, the React adapters, tokens and types into ${codeOut}.`
              }}
            </p>
          </template>
          <template v-else>
            <strong>Choose where code goes</strong>
            <p>
              Add <code>"codegen": {{ '{ "out": "src/ds" }' }}</code> to <code>uidx.json</code>, or
              run <code>npx uidx codegen</code> in a terminal.
            </p>
          </template>
          <button type="button" class="link" @click="showCode = false">Close</button>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 16px;
  flex: none;
  height: 48px;
  padding: 0 12px 0 8px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.start,
.end {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.end {
  justify-content: flex-end;
}
.brand {
  display: grid;
  place-items: center;
  width: 40px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--text);
  background: none;
  cursor: pointer;
}
.brand:hover {
  background: var(--raised);
}
.crumbs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  padding-left: 8px;
  border-left: 1px solid var(--line);
}
.crumb {
  overflow: hidden;
  max-width: 200px;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
button.crumb {
  cursor: pointer;
}
button.crumb:hover {
  color: var(--text);
  background: var(--raised);
}
.crumb.current {
  color: var(--text);
  font-weight: 600;
}
.chevron {
  flex: none;
  color: var(--text-faint);
}
.faces {
  display: flex;
  gap: 2px;
  padding: 3px;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: 9px;
}
.face {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}
.face:hover:not(:disabled) {
  color: var(--text);
}
.face[aria-pressed='true'] {
  background: var(--panel);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.face:disabled {
  opacity: 0.4;
  cursor: default;
}
.history {
  display: flex;
  gap: 2px;
}
.icon-button {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.icon-button:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.icon-button:disabled {
  opacity: 0.35;
  cursor: default;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  color: var(--text-dim);
  font-size: 11px;
  white-space: nowrap;
}
.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--ok);
}
.status[data-state='warn'] .dot,
.status[data-state='busy'] .dot {
  background: var(--warn);
}
.status[data-state='bad'] .dot {
  background: var(--danger);
}
.secondary,
.primary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}
.secondary {
  border: 1px solid var(--line);
  background: var(--panel);
  color: var(--text);
}
.secondary:hover,
.secondary[aria-pressed='true'] {
  background: var(--raised);
}
.primary {
  border: 0;
  background: var(--accent);
  color: var(--on-accent);
  box-shadow: var(--shadow-sm);
}
.primary:hover:not(:disabled) {
  filter: brightness(1.08);
}
.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.code {
  position: relative;
}
.popover {
  position: absolute;
  z-index: 40;
  top: calc(100% + 8px);
  right: 0;
  display: grid;
  gap: 6px;
  width: 300px;
  padding: 14px;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  box-shadow: var(--shadow-float);
  font-size: 12px;
  line-height: 1.5;
}
.popover p {
  margin: 0;
  color: var(--text-dim);
}
.popover code {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}
.link {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  cursor: pointer;
}
button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
@media (max-width: 1180px) {
  .face span,
  .status {
    display: none;
  }
  .face {
    padding: 0 8px;
  }
}
</style>
