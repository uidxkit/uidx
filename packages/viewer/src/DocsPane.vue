<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { JsonValue } from '@uidx/format'

import type { ComponentDocs, DocsExample } from './docs-model'

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
}>()

const emit = defineEmits<{
  /** Open a page on the canvas, selecting an address when one is given. */
  open: [file: string, address?: string]
}>()

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

      <section v-if="docs.intent" class="intent">
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
        No description yet. Write what the component is for above
        <code>## Visual Contract</code>.
      </p>

      <section v-if="docs.examples.length" aria-labelledby="docs-examples">
        <h2 id="docs-examples" class="section-label">EXAMPLES</h2>
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

      <section v-if="docs.behavior.length" aria-labelledby="docs-behavior">
        <h2 id="docs-behavior" class="section-label">BEHAVIOUR</h2>
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
