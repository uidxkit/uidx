<script setup lang="ts">
import { computed, onMounted, ref, watch, type Ref } from 'vue'
import type { JsonValue, UidxDocument, UidxPatch } from '@uidx/format'

import type { ComponentDocs, DocsExample } from './docs-model'
import {
  behaviorPatch,
  exampleProblem,
  examplesOf,
  examplesPatch,
  intentOf,
  ruleProblem,
  rulesOf,
  setChoices,
  type ExampleDraft,
  type RuleDraft,
  type SetChoice,
} from './docs-edits'

/**
 * The Docs face: one component's documentation page, read from its identity
 * — the words above the visual contract, the contract, the behaviour rules
 * and the examples, each example drawn by the canvas's own renderer. It is
 * the page a designer, reviewer or product owner reads without opening the
 * file, and the one that is shared when somebody asks what a component does.
 */
const props = defineProps<{
  docs: ComponentDocs | null
  /** Draws one example; injected so a test can mount the page without CanvasKit. */
  render: (example: DocsExample) => Promise<string | null>
  /** Redraw stamp: moves when anything an example draws through moves. */
  stamp: string
  /** The component's file, parsed, for the editors; none makes the page read-only. */
  doc?: UidxDocument | null
  writable?: boolean
}>()

const emit = defineEmits<{
  /** Open a page on the canvas, selecting an address when one is given. */
  open: [file: string, address?: string]
  /** Writes to the component's file: its intent, behaviour or examples. */
  patches: [file: string, patches: UidxPatch[]]
}>()

/**
 * One section at a time is edited, as a draft: Save sends the whole region
 * as one op (one undo step), Cancel throws the draft away. A draft that the
 * parser would refuse says why and stays open.
 */
const editable = computed(() => props.writable === true && !!props.doc && !!props.docs)
const editing = ref<'intent' | 'behavior' | 'examples' | null>(null)
const problem = ref<string | null>(null)
const intentDraft = ref('')
const rulesDraft = ref<RuleDraft[]>([])
// Typed by hand: Vue's UnwrapRef over JsonValue's recursion is too deep for TS (TS2589).
const examplesDraft = ref([]) as Ref<ExampleDraft[]>
const choices = computed<SetChoice[]>(() => (props.doc ? setChoices(props.doc) : []))
watch(
  () => props.docs?.file,
  () => (editing.value = null),
)

function edit(section: 'intent' | 'behavior' | 'examples'): void {
  const doc = props.doc
  if (!doc) return
  problem.value = null
  intentDraft.value = intentOf(doc)
  rulesDraft.value = rulesOf(doc)
  if (section === 'behavior' && !rulesDraft.value.length) rulesDraft.value = [{ id: '', text: '' }]
  examplesDraft.value = examplesOf(doc)
  if (section === 'examples' && !examplesDraft.value.length) addExample()
  editing.value = section
}

function save(): void {
  const docs = props.docs
  if (!docs || !editing.value) return
  let patch: UidxPatch
  if (editing.value === 'intent') patch = { op: 'intent', text: intentDraft.value }
  else if (editing.value === 'behavior') {
    const rules = rulesDraft.value.filter((rule) => rule.id.trim() || rule.text.trim())
    problem.value = ruleProblem(rules)
    if (problem.value) return
    patch = behaviorPatch(rules)
  } else {
    problem.value = exampleProblem(examplesDraft.value)
    if (problem.value) return
    patch = examplesPatch(examplesDraft.value)
  }
  // Nothing written and nothing to remove is not an edit.
  const empty = patch.op === 'region' && patch.body === undefined
  const had =
    patch.op === 'region' &&
    (patch.name === 'Behavior' ? docs.behavior.length > 0 : docs.examples.length > 0)
  if (!empty || had) emit('patches', docs.file, [patch])
  editing.value = null
}

function addExample(): void {
  const taken = new Set(examplesDraft.value.map((example) => example.name))
  let name = 'example'
  for (let n = 2; taken.has(name); n++) name = `example-${n}`
  const first = choices.value[0]
  examplesDraft.value.push({
    name,
    sets: first ? [{ at: first.name, value: defaultFor(first) }] : [],
  })
}

function defaultFor(choice: SetChoice | undefined): JsonValue {
  if (!choice) return ''
  if (choice.kind === 'choice') return choice.values![0]!
  if (choice.kind === 'boolean') return true
  if (choice.kind === 'number') return 0
  return ''
}

function choiceFor(name: string | undefined): SetChoice | undefined {
  return choices.value.find((choice) => choice.name === name)
}

function retarget(set: { at?: string; value?: JsonValue }, at: string): void {
  set.at = at
  set.value = defaultFor(choiceFor(at))
}

function typed(set: { at?: string }, text: string): JsonValue {
  return choiceFor(set.at)?.kind === 'number' && text.trim() !== '' && !Number.isNaN(Number(text))
    ? Number(text)
    : text
}

const pictures = ref<Record<string, string | null>>({})

async function draw(): Promise<void> {
  const docs = props.docs
  if (!docs) return
  const next: Record<string, string | null> = {}
  for (const example of docs.examples) next[example.name] = await props.render(example)
  pictures.value = next
}
onMounted(draw)
watch(() => [props.docs, props.stamp], draw)

function show(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/** Paragraphs and bullet lists of the intent, with `code` spans kept apart. */
function blocks(text: string): { kind: 'p' | 'ul'; lines: string[] }[] {
  const out: { kind: 'p' | 'ul'; lines: string[] }[] = []
  for (const chunk of text.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').filter((line) => line.trim() !== '')
    if (!lines.length) continue
    if (lines.every((line) => /^\s*[-*]\s/.test(line)))
      out.push({ kind: 'ul', lines: lines.map((line) => line.replace(/^\s*[-*]\s+/, '')) })
    else out.push({ kind: 'p', lines: [lines.join(' ')] })
  }
  return out
}

function spans(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`')
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part },
    )
}

/** The code target's file stem for a component name, as `@uidx/codegen` spells it. */
function stem(name: string): string {
  return name
    .replace(/[/\s]+/g, '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
}

/** Bumped with the stamp so the preview reloads when the document moves. */
const previewKey = ref(0)
watch(
  () => [props.docs, props.stamp],
  () => (previewKey.value += 1),
)

function flags(prop: { controllable?: boolean; visual?: boolean }): string[] {
  const out: string[] = []
  if (prop.visual) out.push('visual')
  if (prop.controllable) out.push('controllable')
  return out
}
</script>

<template>
  <div class="docs-pane">
    <div v-if="!docs" class="docs-content">
      <p class="empty">
        This page declares no component, so it has no documentation. Components live one per page,
        as <code>&lt;Component&gt;</code>.
      </p>
    </div>
    <article v-else class="docs-content">
      <header class="page-heading">
        <div class="eyebrow">DESIGN SYSTEM / COMPONENT</div>
        <h1>
          {{ docs.name }}
          <span v-if="docs.status" class="badge" :data-status="docs.status">{{ docs.status }}</span>
        </h1>
        <p v-if="docs.implements" class="meta">
          Implements <code>{{ docs.implements }}</code>
        </p>
        <button type="button" class="link" @click="emit('open', docs.file)">
          Open on the canvas
        </button>
      </header>

      <section v-if="editing === 'intent'" class="intent editor" data-editor="intent">
        <textarea
          v-model="intentDraft"
          rows="6"
          aria-label="Description"
          placeholder="What this component is for, when to use it, and when to reach for something else. Markdown: blank lines between paragraphs, - for a list, `code` for names."
        />
        <div class="editor-actions">
          <button type="button" class="primary" @click="save">Save</button>
          <button type="button" @click="editing = null">Cancel</button>
        </div>
      </section>
      <section v-else-if="docs.intent" class="intent">
        <button
          v-if="editable"
          type="button"
          class="link edit"
          aria-label="Edit description"
          @click="edit('intent')"
        >
          Edit
        </button>
        <template v-for="(block, b) in blocks(docs.intent)" :key="b">
          <p v-if="block.kind === 'p'">
            <template v-for="(span, s) in spans(block.lines[0]!)" :key="s">
              <code v-if="span.code">{{ span.text }}</code>
              <template v-else>{{ span.text }}</template>
            </template>
          </p>
          <ul v-else>
            <li v-for="(line, l) in block.lines" :key="l">
              <template v-for="(span, s) in spans(line)" :key="s">
                <code v-if="span.code">{{ span.text }}</code>
                <template v-else>{{ span.text }}</template>
              </template>
            </li>
          </ul>
        </template>
      </section>
      <p v-else class="empty">
        No description yet.
        <button v-if="editable" type="button" class="link" @click="edit('intent')">
          Write what it is for
        </button>
        <template v-else>
          Write what the component is for above <code>## Visual Contract</code>.
        </template>
      </p>

      <section
        v-if="editing === 'examples'"
        aria-labelledby="docs-examples"
        class="editor"
        data-editor="examples"
      >
        <h2 id="docs-examples" class="section-label">EXAMPLES</h2>
        <p class="dim">
          Each example is the component with some properties set — the combinations worth showing a
          reader, drawn here and in the review site.
        </p>
        <div v-for="(example, e) in examplesDraft" :key="e" class="example-draft" :data-example="e">
          <div class="draft-row">
            <input v-model="example.name" class="name-input" aria-label="Example name" />
            <button
              type="button"
              class="link danger"
              :aria-label="`Remove example ${example.name}`"
              @click="examplesDraft.splice(e, 1)"
            >
              Remove
            </button>
          </div>
          <div v-for="(set, i) in example.sets" :key="i" class="draft-row set-row">
            <template v-if="set.at !== undefined">
              <select
                :value="set.at"
                aria-label="Property"
                @change="retarget(set, ($event.target as HTMLSelectElement).value)"
              >
                <option v-if="!choiceFor(set.at)" :value="set.at">{{ set.at }}</option>
                <option v-for="choice in choices" :key="choice.name" :value="choice.name">
                  {{ choice.name }}
                </option>
              </select>
              <select
                v-if="choiceFor(set.at)?.kind === 'choice'"
                v-model="set.value"
                aria-label="Value"
              >
                <option v-for="value in choiceFor(set.at)!.values" :key="value" :value="value">
                  {{ value }}
                </option>
              </select>
              <label v-else-if="choiceFor(set.at)?.kind === 'boolean'" class="check">
                <input v-model="set.value" type="checkbox" aria-label="Value" />
                {{ set.value ? 'on' : 'off' }}
              </label>
              <input
                v-else
                :value="show(set.value)"
                aria-label="Value"
                @input="set.value = typed(set, ($event.target as HTMLInputElement).value)"
              />
            </template>
            <span v-else class="dim"
              >fills slot <code>{{ set.slot }}</code
              ><template v-if="set.count !== undefined"> × {{ set.count }}</template></span
            >
            <button
              type="button"
              class="link"
              aria-label="Remove row"
              @click="example.sets.splice(i, 1)"
            >
              ×
            </button>
          </div>
          <button
            v-if="choices.length"
            type="button"
            class="link"
            @click="example.sets.push({ at: choices[0]!.name, value: defaultFor(choices[0]) })"
          >
            + Set a property
          </button>
        </div>
        <button type="button" class="link" @click="addExample">+ Add example</button>
        <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
        <div class="editor-actions">
          <button type="button" class="primary" @click="save">Save examples</button>
          <button type="button" @click="editing = null">Cancel</button>
        </div>
      </section>
      <section v-else-if="docs.examples.length || editable" aria-labelledby="docs-examples">
        <h2 id="docs-examples" class="section-label">
          EXAMPLES
          <button
            v-if="editable"
            type="button"
            class="link edit"
            aria-label="Edit examples"
            @click="edit('examples')"
          >
            {{ docs.examples.length ? 'Edit' : '+ Add' }}
          </button>
        </h2>
        <p v-if="!docs.examples.length" class="empty">
          No examples yet: add the combinations a reader should see.
        </p>
        <div class="examples">
          <figure v-for="example in docs.examples" :key="example.name" class="example">
            <div class="picture">
              <img
                v-if="pictures[example.name]"
                :src="pictures[example.name]!"
                :alt="example.name"
              />
              <span v-else class="empty">Drawing…</span>
            </div>
            <figcaption>
              <strong>{{ example.name }}</strong>
              <span v-if="Object.keys(example.props).length" class="dim">
                <code>{{ JSON.stringify(example.props) }}</code>
              </span>
              <span v-for="set in example.notDrawn" :key="set" class="dim">
                not drawn here: <code>{{ set }}</code>
              </span>
            </figcaption>
          </figure>
        </div>
      </section>

      <section v-if="docs.implements || docs.contract" aria-labelledby="docs-code">
        <h2 id="docs-code" class="section-label">AS THE CODE RENDERS IT</h2>
        <p class="dim">
          The HTML/CSS target's markup and styles for this component, drawn by the browser. Compare
          it with the examples above: a difference is a difference between what is designed and what
          ships. Static — behaviour comes from the headless library.
        </p>
        <iframe
          :key="previewKey"
          class="code-preview"
          :title="`${docs.name} as generated code`"
          :src="`/__uidx/preview?component=${stem(docs.name)}`"
          sandbox=""
        ></iframe>
      </section>

      <template v-if="docs.contract">
        <section v-if="docs.contract.props.length" aria-labelledby="docs-props">
          <h2 id="docs-props" class="section-label">PROPERTIES</h2>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Default</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="prop in docs.contract.props" :key="prop.name">
                <td>
                  <code>{{ prop.name }}</code>
                  <span v-for="flag in flags(prop)" :key="flag" class="tag">{{ flag }}</span>
                </td>
                <td>
                  <code>{{ prop.type }}</code>
                </td>
                <td>
                  <code>{{ show(prop.default) }}</code>
                </td>
                <td>{{ prop.description }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section v-if="docs.contract.events.length" aria-labelledby="docs-events">
          <h2 id="docs-events" class="section-label">EVENTS</h2>
          <table>
            <tbody>
              <tr v-for="event in docs.contract.events" :key="event.name">
                <td>
                  <code>{{ event.name }}</code>
                </td>
                <td>
                  <code>{{ event.detail ?? '' }}</code>
                </td>
                <td>{{ event.description }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section
          v-if="
            docs.contract.slots.length || docs.contract.parts.length || docs.contract.states.length
          "
          aria-labelledby="docs-anatomy"
        >
          <h2 id="docs-anatomy" class="section-label">SLOTS, PARTS AND STATES</h2>
          <table>
            <tbody>
              <tr v-for="slot in docs.contract.slots" :key="`slot-${slot.name}`">
                <td>
                  <span class="tag">slot</span> <code>{{ slot.name }}</code>
                </td>
                <td>
                  <code v-if="slot.accepts">accepts {{ slot.accepts }}</code>
                </td>
                <td>{{ slot.description }}</td>
              </tr>
              <tr v-for="part in docs.contract.parts" :key="`part-${part.name}`">
                <td>
                  <span class="tag">part</span> <code>{{ part.name }}</code>
                </td>
                <td></td>
                <td>{{ part.description }}</td>
              </tr>
              <tr v-for="state in docs.contract.states" :key="`state-${state.name}`">
                <td>
                  <span class="tag">state</span> <code>{{ state.name }}</code>
                </td>
                <td></td>
                <td>{{ state.description }}</td>
              </tr>
            </tbody>
          </table>
        </section>
        <section
          v-if="docs.contract.accessibility || docs.contract.form || docs.contract.composes.length"
          aria-labelledby="docs-a11y"
        >
          <h2 id="docs-a11y" class="section-label">ACCESSIBILITY, FORMS AND COMPOSITION</h2>
          <dl>
            <template v-for="(value, key) in docs.contract.accessibility ?? {}" :key="key">
              <dt>{{ key }}</dt>
              <dd>{{ show(value) }}</dd>
            </template>
            <template v-if="docs.contract.form">
              <dt>form</dt>
              <dd>
                {{ docs.contract.form.participates ? 'participates' : 'does not participate' }}
                <template v-if="docs.contract.form.submits">
                  — submits {{ docs.contract.form.submits }}</template
                >
              </dd>
            </template>
            <template v-if="docs.contract.composes.length">
              <dt>composes with</dt>
              <dd>{{ docs.contract.composes.join(', ') }}</dd>
            </template>
          </dl>
        </section>
      </template>

      <section
        v-if="editing === 'behavior'"
        aria-labelledby="docs-behavior"
        class="editor"
        data-editor="behavior"
      >
        <h2 id="docs-behavior" class="section-label">BEHAVIOUR</h2>
        <p class="dim">
          One rule per line: a short id, then what happens. Developers and agents implement these;
          tests cite them by id.
        </p>
        <div v-for="(rule, r) in rulesDraft" :key="r" class="draft-row rule-row" :data-rule="r">
          <input v-model="rule.id" class="rule-id-input" aria-label="Rule id" placeholder="press" />
          <input
            v-model="rule.text"
            class="rule-text-input"
            aria-label="Rule"
            placeholder="click, Enter or Space fires `press` once"
            @keydown.enter="rulesDraft.push({ id: '', text: '' })"
          />
          <button
            type="button"
            class="link"
            :aria-label="`Remove rule ${rule.id}`"
            @click="rulesDraft.splice(r, 1)"
          >
            ×
          </button>
        </div>
        <button type="button" class="link" @click="rulesDraft.push({ id: '', text: '' })">
          + Add rule
        </button>
        <p v-if="problem" class="problem" role="alert">{{ problem }}</p>
        <div class="editor-actions">
          <button type="button" class="primary" @click="save">Save rules</button>
          <button type="button" @click="editing = null">Cancel</button>
        </div>
      </section>
      <section v-else-if="docs.behavior.length || editable" aria-labelledby="docs-behavior">
        <h2 id="docs-behavior" class="section-label">
          BEHAVIOUR
          <button
            v-if="editable"
            type="button"
            class="link edit"
            aria-label="Edit behaviour"
            @click="edit('behavior')"
          >
            {{ docs.behavior.length ? 'Edit' : '+ Add' }}
          </button>
        </h2>
        <p v-if="!docs.behavior.length" class="empty">
          No behaviour rules yet: say what happens on click, keyboard and focus.
        </p>
        <ul class="rules">
          <li v-for="rule in docs.behavior" :id="`behavior-${rule.id}`" :key="rule.id">
            <code class="rule-id">{{ rule.id }}</code>
            <span>
              <template v-for="(span, s) in spans(rule.text)" :key="s">
                <code v-if="span.code">{{ span.text }}</code>
                <template v-else>{{ span.text }}</template>
              </template>
            </span>
          </li>
        </ul>
      </section>

      <section aria-labelledby="docs-used">
        <h2 id="docs-used" class="section-label">USED IN</h2>
        <p v-if="!docs.usedIn.length" class="empty">No page uses this component yet.</p>
        <ul v-else class="used">
          <li v-for="use in docs.usedIn" :key="`${use.file}:${use.address}`">
            <button type="button" class="link" @click="emit('open', use.file, use.address)">
              {{ use.file }} · {{ use.address }}
            </button>
          </li>
        </ul>
      </section>
    </article>
  </div>
</template>

<style scoped>
.edit {
  margin-left: 8px;
  font-size: 11px;
  letter-spacing: 0;
}
.intent > .edit {
  float: right;
}
.editor textarea,
.editor input,
.editor select {
  padding: 5px 8px;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 5px;
  color-scheme: dark;
}
.editor textarea {
  width: 100%;
  resize: vertical;
}
.draft-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 6px 0;
}
.rule-id-input {
  width: 140px;
  font-family: ui-monospace, monospace;
}
.rule-text-input {
  flex: 1;
}
.example-draft {
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 6px;
}
.example-draft .name-input {
  font-weight: 600;
}
.set-row {
  padding-left: 12px;
}
.check {
  display: inline-flex;
  gap: 6px;
  align-items: center;
}
.editor-actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.editor-actions button {
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  color: var(--text);
  background: none;
  border: 1px solid var(--line);
  border-radius: 5px;
  cursor: pointer;
}
.editor-actions .primary {
  background: var(--accent);
  border-color: var(--accent);
}
.problem {
  color: var(--danger);
}
.danger {
  color: var(--danger);
}
.docs-pane {
  height: 100%;
  min-height: 0;
  min-width: 0;
  flex: 1;
  overflow: auto;
  overscroll-behavior-y: contain;
  background: var(--bg);
}
.docs-content {
  max-width: 960px;
  padding: 26px 36px 60px;
  margin: 0 auto;
  color: var(--text);
  font-size: 13px;
  line-height: 1.6;
}
.eyebrow,
.section-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1em;
  color: var(--text-faint);
}
.section-label {
  margin: 28px 0 10px;
}
h1 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 13px 0 6px;
  font-size: 27px;
  line-height: 1.2;
  font-weight: 600;
  letter-spacing: -0.8px;
}
.badge {
  border: 1px solid var(--line);
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 400;
  letter-spacing: 0;
  color: var(--text-dim);
}
.badge[data-status='stable'] {
  color: var(--ok, var(--text));
}
.meta,
.dim,
.empty {
  color: var(--text-dim);
  font-size: 12px;
}
code {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
}
.intent {
  max-width: 70ch;
  margin-top: 18px;
}
.link {
  padding: 0;
  border: none;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.link:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
th {
  text-align: left;
  font-weight: 500;
  color: var(--text-faint);
  border-bottom: 1px solid var(--line);
  padding: 6px 8px;
}
td {
  vertical-align: top;
  border-bottom: 1px solid var(--line);
  padding: 7px 8px;
}
.tag {
  margin-left: 6px;
  padding: 0 5px;
  border: 1px solid var(--line);
  border-radius: 4px;
  font-size: 10px;
  color: var(--text-dim);
}
td > .tag:first-child {
  margin-left: 0;
}
dl {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: 4px 16px;
  margin: 0;
}
dt {
  color: var(--text-faint);
}
dd {
  margin: 0;
}
.rules,
.used {
  margin: 0;
  padding: 0;
  list-style: none;
}
.rules li {
  display: grid;
  grid-template-columns: minmax(96px, max-content) 1fr;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--line);
}
.rule-id {
  color: var(--accent);
}
.examples {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
}
.example {
  margin: 0;
  border: 1px solid var(--line);
  border-radius: 6px;
  overflow: hidden;
  background: var(--panel);
}
.picture {
  display: grid;
  place-items: center;
  height: 160px;
  background: var(--panel);
}
.picture img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.code-preview {
  width: 100%;
  height: 200px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: #f5f5f5;
}
figcaption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  font-size: 12px;
}
</style>
