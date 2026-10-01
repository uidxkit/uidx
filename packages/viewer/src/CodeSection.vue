<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

/**
 * The Code tab: the selected component as the code it becomes, rendered on
 * the server from the identity in memory and written nowhere — the
 * connection between the design and the code, kept in view the way Builder
 * keeps it. Each target's file is a tab; it refreshes as the design moves.
 */
const props = defineProps<{
  /** The component whose code to show, or null when the selection has none. */
  component: string | null
  /** Moves whenever the document does, so the code refetches. */
  stamp: string
  codegen?: { out: string | null; running: boolean; notice: string }
  writable: boolean
}>()

const emit = defineEmits<{ generateCode: [] }>()

interface CodeFile {
  path: string
  text: string
}
const files = ref<CodeFile[]>([])
const problems = ref<string[]>([])
const loading = ref(false)
const failed = ref('')
const chosen = ref<string | null>(null)
const copied = ref(false)

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
const lines = computed(() => (current.value?.text ?? '').replace(/\n$/, '').split('\n'))

let timer: ReturnType<typeof setTimeout> | undefined
let generation = 0
async function load(): Promise<void> {
  const name = props.component
  const mine = ++generation
  if (!name) {
    files.value = []
    return
  }
  loading.value = true
  failed.value = ''
  try {
    const response = await fetch(`/__uidx/code?component=${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(30_000),
    })
    const body = (await response.json()) as {
      files?: CodeFile[]
      diagnostics?: { file: string; line: number; message: string; severity: string }[]
      error?: string
    }
    if (mine !== generation) return
    if (!response.ok) throw new Error(body.error ?? 'The server could not render code.')
    files.value = body.files ?? []
    problems.value = (body.diagnostics ?? [])
      .filter((d) => d.severity === 'error')
      .map((d) => `${d.file}:${d.line} ${d.message}`)
  } catch (error) {
    if (mine !== generation) return
    files.value = []
    failed.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (mine === generation) loading.value = false
  }
}
// A keystroke in the inspector moves the stamp; the code follows once typing pauses.
watch(
  () => [props.component, props.stamp],
  ([component], previous) => {
    clearTimeout(timer)
    if (component !== previous?.[0]) {
      chosen.value = null
      void load()
    } else timer = setTimeout(() => void load(), 400)
  },
  { immediate: true },
)
onUnmounted(() => clearTimeout(timer))

async function copy(): Promise<void> {
  if (!current.value) return
  try {
    await navigator.clipboard.writeText(current.value.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <section class="code" aria-label="Code">
    <p v-if="!component" class="note">
      Select a component, or an instance of one, to see the code it becomes.
    </p>
    <template v-else>
      <header class="head">
        <span class="title">{{ component }}</span>
        <span class="sub">as code · live</span>
        <span class="grow" />
        <button type="button" class="small" :disabled="!current" data-action="copy" @click="copy">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </header>
      <nav v-if="tabs.length" class="files" aria-label="Generated files">
        <button
          v-for="file in tabs"
          :key="file.path"
          type="button"
          :aria-pressed="current?.path === file.path"
          :title="file.path"
          :data-file="file.path"
          @click="chosen = file.path"
        >
          {{ labelOf(file.path) }}
        </button>
      </nav>
      <p v-if="failed" class="note warn" role="alert">{{ failed }}</p>
      <p v-for="problem in problems" :key="problem" class="note warn">{{ problem }}</p>
      <p v-if="!tabs.length && !loading && !failed && !problems.length" class="note">
        No code yet for {{ component }}.
      </p>
      <div v-if="current" class="block" :data-loading="loading">
        <div class="path">{{ current.path }}</div>
        <pre><code><span v-for="(line, i) in lines" :key="i" class="line"><span class="n">{{ i + 1 }}</span>{{ line }}
</span></code></pre>
      </div>
      <footer class="write">
        <template v-if="codegen?.out">
          <button
            type="button"
            class="primary"
            :disabled="!writable || codegen.running"
            data-action="write"
            @click="emit('generateCode')"
          >
            {{ codegen.running ? 'Writing…' : `Write to ${codegen.out}` }}
          </button>
          <span v-if="codegen.notice" class="notice">{{ codegen.notice }}</span>
        </template>
        <span v-else class="notice">
          To write these files into your project, add
          <code>"codegen": {{ '{ "out": "src/ds" }' }}</code> to <code>uidx.json</code>.
        </span>
      </footer>
    </template>
  </section>
</template>

<style scoped>
.code {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px var(--section-pad) 24px;
}
.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.title {
  font-size: 12px;
  font-weight: 600;
}
.sub {
  color: var(--text-faint);
  font-size: 10px;
}
.grow {
  flex: 1;
}
.small {
  padding: 3px 10px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.small:hover:not(:disabled) {
  background: var(--raised);
}
.files {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 2px;
  background: var(--bg);
  border-radius: 7px;
}
.files button {
  padding: 4px 9px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--text-dim);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.files button[aria-pressed='true'] {
  background: var(--raised);
  color: var(--text);
  box-shadow: var(--shadow-sm);
}
.block {
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--bg);
}
.block[data-loading='true'] {
  opacity: 0.6;
}
.path {
  padding: 6px 10px;
  border-bottom: 1px solid var(--line);
  color: var(--text-faint);
  font:
    10px ui-monospace,
    monospace;
}
pre {
  max-height: 440px;
  margin: 0;
  overflow: auto;
  padding: 8px 0;
  font:
    11px/1.55 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  color: var(--text);
}
.line {
  display: block;
  padding-right: 10px;
  white-space: pre;
}
.n {
  display: inline-block;
  width: 34px;
  padding-right: 10px;
  color: var(--text-faint);
  text-align: right;
  user-select: none;
}
.write {
  display: grid;
  gap: 6px;
}
.primary {
  justify-self: start;
  padding: 6px 12px;
  border: 0;
  border-radius: 6px;
  background: var(--accent);
  color: var(--on-accent);
  font: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.primary:disabled {
  opacity: 0.6;
  cursor: default;
}
.notice,
.note {
  margin: 0;
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1.5;
}
.note.warn {
  color: var(--warn);
}
code {
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
</style>
