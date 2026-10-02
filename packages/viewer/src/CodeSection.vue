<script setup lang="ts">
import { computed, onUnmounted, ref, useId, watch } from 'vue'

import { FieldIcon } from './field-icons'
import { headlessFailure, unavailable, type CodegenState, type Diagnostic } from './headless'
import InspectorEmpty from './InspectorEmpty.vue'
import InspectorSection from './InspectorSection.vue'
import {
  ACTION,
  COPY,
  EMPTY,
  INFO,
  classifyFailure,
  codeItems,
  noFiles,
  requestItem,
  writeBlockedReason,
  type Failure,
  type MessageAction,
  type StatusItem,
} from './inspector-messages'

/**
 * The Code tab: the selected component as the code it becomes, rendered on
 * the server from the identity in memory and written nowhere — the
 * connection between the design and the code, kept in view the way Builder
 * keeps it. Each target's file is a tab; it refreshes as the design moves.
 *
 * What stops the code is not said here: after each render the tab reports
 * its state and status items to the shell (`status`), whose status line
 * words it the same way as the other tabs. The body only says where the
 * code would be, and the footer writes every component at once.
 */
const props = defineProps<{
  /** The component whose code to show, or null when the selection has none. */
  component: string | null
  /** Moves whenever the document does, so the code refetches. */
  stamp: string
  codegen?: CodegenState
  writable: boolean
  /** 'of List' when the code shown is not the selected layer's own component. */
  relation?: string | null
  /** The file the component is defined in, so its own problems read apart from other files'. */
  file?: string
  /** Moves when the reader asks to retry, so the code refetches at once. */
  reload?: number
}>()

/** The tab's state after a render, for the shell's status line and tab dot. */
interface CodeReport {
  component: string
  state: 'live' | 'updating' | 'blocked' | 'failed'
  items: StatusItem[]
}

const emit = defineEmits<{
  generateCode: []
  status: [report: CodeReport]
  act: [action: MessageAction]
}>()

interface CodeFile {
  path: string
  text: string
}
const files = ref<CodeFile[]>([])
/** The generator's errors; while there are any, there is no code to show or write. */
const problems = ref<Diagnostic[]>([])
/** The request itself failed, or the server refused the component's name. */
const failed = ref<Failure | { status: 404 } | null>(null)
const loading = ref(false)
/** A render has taken long enough to notice: quick refreshes do not blink the header. */
const updating = ref(false)
const chosen = ref<string | null>(null)

/** What a file is, in a reader's words, from the target folder it is written to. */
function labelOf(path: string): string {
  const [target, name = ''] = path.split('/')
  const ext = name.slice(name.lastIndexOf('.') + 1)
  if (target === 'react') return ext === 'css' ? 'React CSS' : 'React'
  if (target === 'html') return ext === 'css' ? 'CSS' : 'HTML'
  if (target === 'contract') return 'Contract'
  return path
}
const ORDER = ['React', 'HTML', 'CSS', 'React CSS', 'Contract']
const tabs = computed(() =>
  [...files.value].sort((a, b) => ORDER.indexOf(labelOf(a.path)) - ORDER.indexOf(labelOf(b.path))),
)
const current = computed(
  () => tabs.value.find((file) => file.path === chosen.value) ?? tabs.value[0] ?? null,
)
/** The file on show: none while the generator reports errors or the request failed. */
const shown = computed(() => (problems.value.length || failed.value ? null : current.value))
const lines = computed(() => (shown.value?.text ?? '').replace(/\n$/, '').split('\n'))
const selected = computed(() => shown.value?.path ?? null)

const meta = computed(
  () =>
    [props.relation, updating.value ? COPY.updating : ''].filter(Boolean).join(' · ') || undefined,
)

const isError = (d: Diagnostic): boolean => d.severity === 'error'

let timer: ReturnType<typeof setTimeout> | undefined
let slowTimer: ReturnType<typeof setTimeout> | undefined
let generation = 0
/**
 * Fetches the component's code. The previous result stays until the new
 * one replaces it whole — files, problems and failure together — so a
 * keystroke never flashes the status line or the code away and back.
 */
async function load(): Promise<void> {
  const name = props.component
  const mine = ++generation
  clearTimeout(slowTimer)
  if (!name) {
    files.value = []
    problems.value = []
    failed.value = null
    loading.value = updating.value = false
    return
  }
  loading.value = true
  slowTimer = setTimeout(() => (updating.value = true), 300)
  let next: { files: CodeFile[]; problems: Diagnostic[]; failed: typeof failed.value }
  try {
    const response = await fetch(`/__uidx/code?component=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    unavailable(response)
    const body = (await response.json()) as {
      files?: CodeFile[]
      diagnostics?: Diagnostic[]
      error?: string
      code?: string
    }
    if (response.status === 404) next = { files: [], problems: [], failed: { status: 404 } }
    else if (!response.ok)
      throw Object.assign(new Error(body.error ?? 'The server could not render code.'), {
        code: body.code,
      })
    else
      next = {
        files: body.files ?? [],
        problems: (body.diagnostics ?? []).filter(isError),
        failed: null,
      }
  } catch (error) {
    next = { files: [], problems: [], failed: classifyFailure(error) }
  }
  if (mine !== generation) return
  clearTimeout(slowTimer)
  files.value = next.files
  problems.value = next.problems
  failed.value = next.failed
  loading.value = updating.value = false
  report(name)
}

/**
 * Tells the shell how the last render went. A request that failed while the
 * library cannot be read failed because of it: the library's own status
 * item says so, with the fix, so the tab adds nothing to it.
 */
function report(component: string): void {
  const fault = failed.value
  emit('status', {
    component,
    state: fault ? 'failed' : problems.value.length ? 'blocked' : 'live',
    items: !fault
      ? codeItems(problems.value, props.file)
      : headlessFailure.value && !('status' in fault)
        ? []
        : [requestItem(fault)],
  })
}
// A keystroke in the inspector moves the stamp; the code follows once typing pauses.
watch(
  () => [props.component, props.stamp],
  ([component], previous) => {
    clearTimeout(timer)
    if (component !== previous?.[0]) {
      // Another component: nothing of the last one's may show under its name.
      chosen.value = null
      files.value = []
      problems.value = []
      failed.value = null
      void load()
    } else timer = setTimeout(() => void load(), 400)
  },
  { immediate: true },
)
watch(
  () => props.reload,
  () => {
    clearTimeout(timer)
    void load()
  },
)
// A library that loads again may be all the code was waiting for.
watch(headlessFailure, (now, before) => {
  if (!props.component || loading.value) return
  if (before && !now) void load()
  else report(props.component)
})

/** Long lines scroll inside the listing by default; wrapping is the reader's choice, remembered. */
const WRAP_KEY = 'uidx.code.wrap'
function readWrap(): boolean {
  try {
    return localStorage.getItem(WRAP_KEY) === 'true'
  } catch {
    return false
  }
}
const wrap = ref(readWrap())
function toggleWrap(): void {
  wrap.value = !wrap.value
  try {
    localStorage.setItem(WRAP_KEY, String(wrap.value))
  } catch {
    // Storage blocked: the toggle still works, it just forgets.
  }
}

const copied = ref(false)
const copyFailed = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined
const copyLabel = computed(() => (shown.value ? `Copy ${shown.value.path}` : 'Copy code'))
async function copy(): Promise<void> {
  const file = shown.value
  if (!file) return
  clearTimeout(copyTimer)
  try {
    await navigator.clipboard.writeText(file.text)
    copied.value = true
    copyFailed.value = false
  } catch {
    copied.value = false
    copyFailed.value = true
  }
  copyTimer = setTimeout(() => (copied.value = copyFailed.value = false), 1500)
}

/** The file tabs move with the arrow keys, Home and End, as a tab list does. */
const panelId = useId()
function step(event: KeyboardEvent, index: number): void {
  const last = tabs.value.length - 1
  const next =
    event.key === 'ArrowRight'
      ? index === last
        ? 0
        : index + 1
      : event.key === 'ArrowLeft'
        ? index === 0
          ? last
          : index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : -1
  if (next < 0) return
  event.preventDefault()
  chosen.value = tabs.value[next]!.path
  const list = (event.currentTarget as HTMLElement).parentElement
  ;(list?.children[next] as HTMLElement | undefined)?.focus()
}

const canWrite = computed(
  () =>
    props.writable &&
    !props.codegen?.running &&
    !problems.value.length &&
    !failed.value &&
    tabs.value.length > 0,
)
const writeTitle = computed(() =>
  writeBlockedReason({
    writable: props.writable,
    problems: problems.value.length,
    files: tabs.value.length,
    out: props.codegen?.out ?? null,
  }),
)

onUnmounted(() => {
  clearTimeout(timer)
  clearTimeout(slowTimer)
  clearTimeout(copyTimer)
})
</script>

<template>
  <section class="code" aria-label="Code">
    <InspectorEmpty v-if="!component" kind="none" v-bind="EMPTY.code.none" />
    <template v-else>
      <InspectorSection title="Code" :meta="meta" :info="INFO.code">
        <template #actions>
          <button
            type="button"
            class="cluster-btn"
            data-action="wrap"
            aria-label="Wrap lines"
            title="Wrap lines"
            :aria-pressed="wrap"
            :disabled="!shown"
            @click="toggleWrap"
          >
            <FieldIcon name="wrap" />
          </button>
          <button
            type="button"
            class="cluster-btn"
            data-action="copy"
            :aria-label="copyLabel"
            :title="copied ? 'Copied' : copyLabel"
            :disabled="!shown"
            @click="copy"
          >
            <FieldIcon :name="copied ? 'check' : 'copy'" />
          </button>
          <span class="sr-only" aria-live="polite">{{
            copied ? 'Copied' : copyFailed ? "Couldn't copy" : ''
          }}</span>
        </template>
        <nav
          v-if="shown && tabs.length > 1"
          class="files enum-segmented"
          role="tablist"
          aria-label="Generated files"
        >
          <button
            v-for="(tab, index) in tabs"
            :key="tab.path"
            type="button"
            class="enum-item"
            role="tab"
            :aria-selected="selected === tab.path"
            :aria-controls="panelId"
            :tabindex="selected === tab.path ? 0 : -1"
            :data-state="selected === tab.path ? 'on' : 'off'"
            :title="tab.path"
            :data-file="tab.path"
            @click="chosen = tab.path"
            @keydown="step($event, index)"
          >
            {{ labelOf(tab.path) }}
          </button>
        </nav>
        <p v-if="problems.length || failed" class="hint">{{ COPY.codeBlocked }}</p>
        <InspectorEmpty
          v-else-if="!tabs.length && !loading"
          kind="no-files"
          v-bind="noFiles(component)"
          @act="emit('act', $event)"
        />
      </InspectorSection>
      <div
        v-if="shown"
        :id="panelId"
        class="source"
        :role="tabs.length > 1 ? 'tabpanel' : undefined"
        :aria-label="shown.path"
        :data-loading="updating"
      >
        <div class="source-head">
          <span class="path" :title="shown.path">{{ shown.path }}</span>
          <span class="lines"
            >· {{ lines.length }} {{ lines.length === 1 ? 'line' : 'lines' }}</span
          >
        </div>
        <pre
          :data-wrap="wrap"
        ><code><span v-for="(line, i) in lines" :key="i" class="line"><span class="n">{{ i + 1 }}</span>{{ line }}
</span></code></pre>
      </div>
      <footer v-if="tabs.length || problems.length" class="write">
        <template v-if="codegen?.out">
          <button
            type="button"
            class="btn block"
            data-action="write"
            :disabled="!canWrite"
            :title="writeTitle"
            @click="emit('generateCode')"
          >
            {{ codegen.running ? 'Writing…' : 'Write code' }}
          </button>
          <p class="caption" :title="codegen.out">{{ COPY.writeTo(codegen.out) }}</p>
          <p v-if="codegen.result?.kind === 'ok'" class="caption done" role="status">
            <FieldIcon name="check" />{{ COPY.wrote(codegen.result.written) }}
          </p>
        </template>
        <p v-else class="caption setup">
          {{ COPY.noOutput }}
          <button type="button" class="link-button" @click="emit('act', ACTION.setFolder)">
            {{ ACTION.setFolder.label }}
          </button>
        </p>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.code {
  display: block;
  padding: 0 0 24px;
}
/* The sticky footer is the tab's last edge. */
.code:has(> .write) {
  padding-bottom: 0;
}
.hint {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
/* One row that never wraps: each segment gets its label's width while
   they fit and a fair share once they do not, ellipsized, so five targets
   fit the narrowest pane. The shared `.enum-segmented` rules size it like
   the Design tab's segmented controls. */
.files {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: minmax(0, auto);
  gap: 2px;
  box-sizing: border-box;
  height: var(--field-h);
  margin: 0;
  padding: 2px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
}
.files .enum-item {
  min-width: 0;
  padding: 0 4px;
  overflow: hidden;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  font: var(--ui-size-sm) / 1 var(--ui-font);
  white-space: nowrap;
  text-overflow: ellipsis;
  cursor: pointer;
}
.files .enum-item:hover {
  color: var(--text);
}
.files .enum-item[data-state='on'] {
  background: var(--panel);
  border-color: var(--line);
  color: var(--text);
}
/* Full-bleed, like a section: the section's rule above is its top edge and
   the footer's its bottom one. */
.source {
  margin: 0 calc(-1 * var(--section-pad));
  background: var(--bg);
  transition: opacity 0.15s;
}
.source[data-loading='true'] {
  opacity: 0.6;
}
.source-head {
  display: flex;
  gap: 6px;
  min-width: 0;
  padding: 6px var(--section-pad);
  border-bottom: 1px solid var(--line);
  color: var(--text-faint);
  font: 11px/16px var(--mono-font);
  white-space: nowrap;
}
.path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lines {
  flex: none;
}
/* Only the code scrolls sideways, never the pane. */
pre {
  margin: 0;
  padding: 8px 0;
  overflow-x: auto;
  color: var(--text);
  font: 11px/17px var(--mono-font);
}
.line {
  display: block;
  padding-right: var(--section-pad);
  white-space: pre;
}
.n {
  display: inline-block;
  box-sizing: border-box;
  width: 40px;
  padding-right: 8px;
  color: var(--text-faint);
  text-align: right;
  user-select: none;
}
/* Unwrapped, every line is as wide as the longest, so the numbers can stay
   pinned while the code scrolls under them. */
pre[data-wrap='false'] code {
  display: block;
  width: max-content;
  min-width: 100%;
}
pre[data-wrap='false'] .n {
  position: sticky;
  left: 0;
  background: var(--bg);
}
pre[data-wrap='true'] .line {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
pre[data-wrap='true'] .n {
  width: auto;
}
/* Write code stays in reach at the bottom of the pane however long the
   file; the -1px lays its rule over the one above it. */
.write {
  position: sticky;
  bottom: 0;
  z-index: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 4px;
  margin: -1px calc(-1 * var(--section-pad)) 0;
  padding: 12px var(--section-pad);
  border-top: 1px solid var(--line);
  background: var(--panel);
}
.caption {
  margin: 0;
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 16px;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.caption.done {
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
}
.caption.done :deep(svg) {
  flex: none;
  color: var(--ok);
}
/* A sentence with its fix: it wraps rather than cut the link off. */
.caption.setup {
  white-space: normal;
}
</style>
