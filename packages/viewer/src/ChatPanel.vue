<script setup lang="ts">
/**
 * The chat surface. It knows the page and the selection, sends them with every
 * message, and renders tool activity so the run is legible while it happens.
 * It never touches the document — the agent writes files, the socket brings
 * the change back through the normal file-changed path.
 */
import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport, type UIMessage } from 'ai'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { chatBody, revertTurn } from './agent-client'

const props = defineProps<{
  documentId: string | null
  page: string | null
  selection: readonly string[]
  url: string
}>()

const emit = defineEmits<{
  close: []
  /** A reply finished; `written` is the source hashes of every file its turn wrote (spec §5). */
  'turn-finished': [{ turnId: string; written: string[] }]
}>()

const input = ref('')

const { messages, status, error, sendMessage, stop, clearError } = useChat(() => ({
  transport: new DefaultChatTransport({ api: `${props.url}/chat` }),
}))

/**
 * A reply finishing is the moment the shell can attribute revisions to the
 * turn (spec §5): the service stamps every write's source hash into the
 * message metadata, and the undo stack folds the matching external entries
 * into one "LLM turn". Watched on `status` rather than on the message list,
 * because metadata arrives with the `finish` part and the list settles first.
 */
watch(status, (now, before) => {
  if (before !== 'streaming' && before !== 'submitted') return
  if (now !== 'ready') return
  const last = [...messages.value].reverse().find((m) => m.role === 'assistant')
  const metadata = last?.metadata as { turnId?: unknown; written?: unknown } | undefined
  if (typeof metadata?.turnId !== 'string' || metadata.turnId === '') return
  const written = Array.isArray(metadata.written)
    ? metadata.written
        .map((w) => (w as { sourceHash?: unknown } | null)?.sourceHash)
        .filter((h): h is string => typeof h === 'string')
    : []
  emit('turn-finished', { turnId: metadata.turnId, written })
})

const busy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const canSend = computed(() => input.value.trim().length > 0 && !busy.value)

/**
 * Seconds since the current turn started, or 0 when nothing is running.
 *
 * A local 9B model takes minutes on a real task, and it thinks for long
 * stretches with nothing to stream. Without a clock, a working run and a hung
 * one look identical, and the honest answer to "is it still going?" is a
 * number that keeps moving.
 */
const elapsed = ref(0)
let ticking: ReturnType<typeof setInterval> | null = null

function stopTicking(): void {
  if (ticking === null) return
  clearInterval(ticking)
  ticking = null
}

// `immediate` because the panel can be opened onto a turn that is already
// running — it is closable mid-run, and the toggle remounts it. Without it the
// watcher waits for a change that already happened and the clock sits at 0s
// for the rest of the turn, which is worse than showing no clock at all.
watch(
  busy,
  (running) => {
    stopTicking()
    elapsed.value = 0
    if (!running) return
    const started = Date.now()
    ticking = setInterval(() => {
      elapsed.value = Math.floor((Date.now() - started) / 1000)
    }, 1000)
  },
  { immediate: true },
)

// A panel torn down mid-turn must not leave its interval running.
onBeforeUnmount(stopTicking)

const elapsedLabel = computed(() => {
  if (elapsed.value < 60) return `${elapsed.value}s`
  return `${Math.floor(elapsed.value / 60)}m ${String(elapsed.value % 60).padStart(2, '0')}s`
})

/** A tool part mid-flight carries a partial input, so every field here is a maybe. */
type ToolInput = { file?: unknown; query?: unknown; name?: unknown; mission?: unknown }

const str = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null

/**
 * What the agent is doing right now, in the designer's words rather than the
 * tool's. Falls back to the tool's own name rather than inventing a phrase for
 * a tool this panel has not been taught, so a new tool reads as unfamiliar
 * rather than as nothing happening.
 */
function activityFor(tool: string, input: ToolInput): string {
  switch (tool) {
    case 'read':
      return str(input.file) ? `Reading ${str(input.file)}` : 'Reading'
    case 'search':
      return str(input.query) ? `Searching for “${str(input.query)}”` : 'Searching'
    case 'edit':
      return str(input.file) ? `Editing ${str(input.file)}` : 'Editing'
    case 'create_file':
      return str(input.file) ? `Creating ${str(input.file)}` : 'Creating a page'
    case 'delete_file':
      return str(input.file) ? `Deleting ${str(input.file)}` : 'Deleting a page'
    case 'use_skill':
      return str(input.name) ? `Reading the ${str(input.name)} skill` : 'Reading a skill'
    case 'plan':
      return 'Updating the plan'
    case 'delegate':
      return 'Handing off a sub-task'
    default:
      return `Running ${tool}`
  }
}

/**
 * The single line under the log while a turn runs.
 *
 * Read off the last assistant message rather than tracked separately, so it
 * can never disagree with what the log shows. A tool whose output has already
 * arrived is not what the agent is doing *now* — the search stops at the last
 * tool part and reports it only while it is still in flight.
 */
const activity = computed<string | null>(() => {
  if (!busy.value) return null
  const last = messages.value.at(-1)
  if (status.value === 'submitted' || !last || last.role !== 'assistant') return 'Thinking'

  for (let i = last.parts.length - 1; i >= 0; i -= 1) {
    const part = last.parts[i]
    if (!part) continue
    if (part.type === 'text') return 'Writing'
    if (!part.type.startsWith('tool-')) continue
    const { state, input } = part as { state?: string; input?: ToolInput }
    if (state === 'output-available' || state === 'output-error') break
    return activityFor(part.type.replace('tool-', ''), input ?? {})
  }
  return 'Thinking'
})

const selectionLabel = computed(() =>
  props.selection.length > 0 ? props.selection.join(', ') : 'nothing selected',
)

/**
 * The task id a reply's metadata carried, or null.
 *
 * Mirrors `turnOf` below, but for `taskId` rather than `turnId` — the service
 * stamps both on every assistant message (see `turn.ts`'s `chat()`).
 */
function taskIdOf(message: UIMessage): string | null {
  if (message.role !== 'assistant') return null
  const metadata = message.metadata as { taskId?: unknown } | undefined
  return typeof metadata?.taskId === 'string' && metadata.taskId !== '' ? metadata.taskId : null
}

/**
 * The task id this conversation is pinned to, once a reply has supplied one —
 * null for a fresh conversation whose first turn hasn't answered yet. Scans
 * front to back and keeps the first one found, so it stays put at whatever
 * the first reply named even once later replies arrive: every reply for one
 * conversation names the same task, so which one is read back makes no
 * difference except when a message from before this feature existed carries
 * none at all.
 */
const taskId = computed<string | null>(() => {
  for (const candidate of messages.value) {
    const id = taskIdOf(candidate)
    if (id) return id
  }
  return null
})

function send(): void {
  if (!canSend.value) return
  const text = input.value
  input.value = ''
  void sendMessage(
    { text },
    {
      body: chatBody({
        documentId: props.documentId,
        page: props.page,
        selection: props.selection,
        taskId: taskId.value,
      }),
    },
  )
}

/**
 * How many plan steps the latest reply says are still not `done`, or 0 for a
 * message that reports none — a turn that never touched the plan tool, or
 * one from before this feature existed.
 */
function planRemainingOf(message: UIMessage): number {
  const metadata = message.metadata as { planRemaining?: unknown } | undefined
  return typeof metadata?.planRemaining === 'number' ? metadata.planRemaining : 0
}

/**
 * Whether the very last message in the log is an assistant reply reporting
 * unfinished plan steps — the only case "Continue" belongs. Gated on the
 * *latest* message specifically, not any reply anywhere in the log: once the
 * user has typed something new, or the plan is finished, the control that
 * used to make sense stops applying.
 */
const canContinue = computed(() => {
  const last = messages.value.at(-1)
  return last !== undefined && last.role === 'assistant' && planRemainingOf(last) > 0
})

/**
 * Asks for another turn on the same task — the panel's own nudge for a job
 * too big to finish in one turn. Carries the same task id every other
 * message in this conversation does, so the service resumes the one plan
 * file rather than starting a fresh, unreachable one (see `taskId` above).
 */
function continueTask(): void {
  if (!canContinue.value || busy.value) return
  void sendMessage(
    { text: 'Continue.' },
    {
      body: chatBody({
        documentId: props.documentId,
        page: props.page,
        selection: props.selection,
        taskId: taskId.value,
      }),
    },
  )
}

/**
 * The turn a reply came out of, or null for anything that is not one.
 *
 * The service stamps every assistant message's metadata with the turn id it
 * checkpointed under. A message without one — a user's own line, or a reply
 * from a service too old to stamp it — simply gets no control, rather than one
 * that would fail when pressed.
 */
function turnOf(message: UIMessage): string | null {
  if (message.role !== 'assistant') return null
  const metadata = message.metadata as { turnId?: unknown } | undefined
  return typeof metadata?.turnId === 'string' && metadata.turnId !== '' ? metadata.turnId : null
}

/** The log, with each row carrying the turn it can undo. */
const rows = computed(() => messages.value.map((message) => ({ message, turn: turnOf(message) })))

/** The turn currently being reverted, so its control can say so. */
const reverting = ref<string | null>(null)
const revertError = ref<string | null>(null)

/**
 * Restores what one turn wrote. The canvas follows on its own — the service
 * rewrites the files and the uidx server's watch carries them back — so there
 * is nothing to do here on success but stop saying it is in flight.
 */
async function revert(turnId: string): Promise<void> {
  reverting.value = turnId
  revertError.value = null
  try {
    await revertTurn(props.url, {
      documentId: props.documentId,
      page: props.page,
      turnId,
    })
  } catch (failure) {
    // Surfaced, never swallowed: checkpoints are the only undo uidx has, and a
    // revert that silently did nothing leaves the change on canvas looking as
    // though it worked.
    revertError.value = failure instanceof Error ? failure.message : String(failure)
  } finally {
    reverting.value = null
  }
}
</script>

<template>
  <aside class="chat" aria-label="Agent chat">
    <header class="head">
      <span class="title">Agent</span>
      <span class="spacer" />
      <button type="button" class="icon" aria-label="Close chat" @click="emit('close')">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </header>

    <p class="context">{{ page ?? 'no page open' }} · {{ selectionLabel }}</p>

    <div class="log" role="log" aria-live="polite">
      <div v-for="row in rows" :key="row.message.id" class="msg" :data-role="row.message.role">
        <template v-for="(part, i) in row.message.parts" :key="`${row.message.id}-${i}`">
          <p v-if="part.type === 'text'" class="text">{{ part.text }}</p>
          <p v-else-if="part.type.startsWith('tool-')" class="tool">
            {{ part.type.replace('tool-', '') }}
          </p>
          <!--
            Anything else — reasoning, a file, a source, a step boundary — still
            gets a row. A run that goes visibly quiet reads as stalled, and the
            header comment promises the log stays legible while it works.
          -->
          <p v-else class="tool">{{ part.type }}</p>
        </template>
        <!--
          Checkpoints are the only undo uidx has under a turn, so this is the
          one control that can take one back. Per message rather than for the
          last turn alone: each reply carries the turn it came out of.
        -->
        <button
          v-if="row.turn"
          type="button"
          class="revert"
          aria-label="Revert this turn"
          :disabled="reverting === row.turn"
          @click="revert(row.turn)"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.2 5.6A3.8 3.8 0 1 1 3 8.4" fill="none" stroke="currentColor" />
            <path d="M0.8 3.2v2.6h2.6" fill="none" stroke="currentColor" />
          </svg>
          <span>{{ reverting === row.turn ? 'Reverting…' : 'Revert this turn' }}</span>
        </button>
      </div>
      <!--
        A job too big for one turn leaves work behind when the turn ends —
        this is the control that asks for another turn on the same task
        rather than making the designer retype the request. Only on the
        latest reply: `canContinue` already checks that.
      -->
      <button
        v-if="canContinue"
        type="button"
        class="continue"
        aria-label="Continue"
        :disabled="busy"
        @click="continueTask"
      >
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3.5 2v8l6-4-6-4z" fill="currentColor" />
        </svg>
        <span>Continue</span>
      </button>
      <div v-if="revertError" class="failed">
        <p role="alert">{{ revertError }}</p>
        <button
          type="button"
          class="icon"
          aria-label="Dismiss revert error"
          @click="revertError = null"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" />
          </svg>
        </button>
      </div>
      <!--
        Proof the run is alive. A local model thinks for minutes with nothing
        to stream, and the log alone cannot tell a working turn from a hung
        one — so this names what is happening and counts while it happens.
        The log is already an aria-live region, so it needs no second one.
      -->
      <p v-if="activity" class="working">
        <span class="pulse" aria-hidden="true" />
        <span>{{ activity }}…</span>
        <span class="elapsed">{{ elapsedLabel }}</span>
      </p>
      <div v-if="error" class="failed">
        <p role="alert">{{ error.message }}</p>
        <button type="button" class="icon" aria-label="Dismiss error" @click="clearError">
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" />
          </svg>
        </button>
      </div>
    </div>

    <form class="compose" @submit.prevent="send">
      <textarea
        v-model="input"
        rows="2"
        placeholder="Ask for a change…"
        aria-label="Message"
        @keydown.enter.exact.prevent="send"
      />
      <button v-if="busy" type="button" class="icon" aria-label="Stop" @click="stop">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <rect x="3" y="3" width="6" height="6" fill="currentColor" />
        </svg>
      </button>
      <button v-else type="submit" class="icon" aria-label="Send" :disabled="!canSend">
        <svg viewBox="0 0 12 12" aria-hidden="true">
          <path d="M2 6h8M6.5 2.5L10 6l-3.5 3.5" fill="none" stroke="currentColor" />
        </svg>
      </button>
    </form>
  </aside>
</template>

<style scoped>
.chat {
  position: fixed;
  right: var(--gap);
  bottom: var(--gap);
  z-index: 30;
  display: flex;
  flex-direction: column;
  width: 320px;
  max-height: 60vh;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--panel);
  box-shadow: var(--shadow);
  font: var(--ui-size) / var(--ui-line) var(--ui-font);
  color: var(--text);
}

.head {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  padding: var(--gap-sm) var(--pad);
  border-bottom: 1px solid var(--line);
}

.title {
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.context {
  margin: 0;
  padding: var(--gap-sm) var(--pad);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  border-bottom: 1px solid var(--line);
}

.log {
  flex: 1;
  overflow-y: auto;
  padding: var(--pad);
  display: flex;
  flex-direction: column;
  gap: var(--gap);
}

.msg[data-role='user'] .text {
  color: var(--text);
}

.msg[data-role='assistant'] .text {
  color: var(--text-dim);
}

.text {
  margin: 0;
  white-space: pre-wrap;
}

.tool {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}

/* Inline, so each sizes to its own label rather than becoming a full-width
   hit area — "Revert this turn" under the reply it undoes, "Continue" under
   the log entirely (it acts on the whole task, not one message). */
.revert,
.continue {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-sm);
  margin-top: var(--gap-sm);
  padding: 0;
  border: none;
  background: none;
  color: var(--text-faint);
  font: inherit;
  font-size: var(--ui-size-sm);
  cursor: pointer;
}

.revert:hover:not(:disabled),
.continue:hover:not(:disabled) {
  color: var(--text-dim);
}

.revert:disabled,
.continue:disabled {
  cursor: default;
}

.revert svg,
.continue svg {
  width: var(--icon);
  height: var(--icon);
  stroke-width: 1;
}

.working {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}

/* Sits on the text baseline's optical centre rather than the line box's, so
   it reads as part of the sentence and not as a bullet beside it. */
.pulse {
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: pulse 1.4s ease-in-out infinite;
}

/* Pushed to the far end so the label can grow — a long filename must not
   shove the clock out of the panel. */
.elapsed {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.25;
  }
  50% {
    opacity: 1;
  }
}

/* The clock still ticks, which is the part that actually says "alive" — only
   the motion goes. */
@media (prefers-reduced-motion: reduce) {
  .pulse {
    animation: none;
    opacity: 0.6;
  }
}

.failed {
  display: flex;
  align-items: flex-start;
  gap: var(--gap-sm);
}

.failed p {
  flex: 1;
  margin: 0;
  color: var(--danger);
}

.compose {
  display: flex;
  align-items: flex-end;
  gap: var(--gap-sm);
  padding: var(--gap-sm);
  border-top: 1px solid var(--line);
}

textarea {
  flex: 1;
  resize: none;
  padding: var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--text);
  font: inherit;
}

.icon {
  display: grid;
  place-items: center;
  width: var(--field-h);
  height: var(--field-h);
  border: none;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}

.icon:hover:not(:disabled) {
  background: var(--raised);
}

.icon:disabled {
  color: var(--text-faint);
  cursor: default;
}

.icon svg {
  width: var(--icon);
  height: var(--icon);
  stroke-width: 1;
}
</style>
