<script setup lang="ts">
import { computed, ref } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import type { HeadlessCandidate, HeadlessLibrary } from './headless'
import type { ComponentNames, ConfigChange, ConnectionConfig, ReactMapping } from './headless'
import { setImplements } from './contract-edits'

/**
 * The Connect tab: how a component's identity reaches code, managed in one
 * place (ADR 0013 §3, ADR 0017 §3). Builder calls this component mapping.
 *
 * Two homes, said on screen so nobody wonders where a value went: the
 * element the component implements and the parts its layers bind live in
 * the component's `.uidx` file; the library's names, the React component it
 * renders onto, the naming profile and where code goes live in `uidx.json`.
 * The Code tab renders from all of it.
 */
const props = defineProps<{
  doc: UidxDocument | null
  /** The component being connected: the selection, or the one it sits in. */
  component: UidxNode | null
  library: HeadlessLibrary | null
  candidates?: HeadlessCandidate[]
  config: ConnectionConfig
  error?: string
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  save: [change: ConfigChange]
  chooseLibrary: [path: string]
  openContract: []
}>()

const name = computed(() => props.component?.name ?? '')
const contract = computed(() => props.component?.spec?.contract)
const propsList = computed(() => contract.value?.props ?? [])
const events = computed(() => contract.value?.events ?? [])
const slots = computed(() => contract.value?.slots ?? [])
const partsDeclared = computed(() => contract.value?.parts ?? [])

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const counts = computed(() =>
  [
    plural(propsList.value.length, 'prop'),
    plural(events.value.length, 'event'),
    plural(slots.value.length, 'slot'),
    `${partsBound.value}/${partsDeclared.value.length} parts bound`,
  ].join(' · '),
)

const implementsTag = computed(() => {
  const value = props.component?.attrs.implements?.value
  return typeof value === 'string' ? value : ''
})
const element = computed(() =>
  implementsTag.value ? (props.library?.elements.get(implementsTag.value) ?? null) : null,
)
/** Layers carrying `part`, against the parts the contract declares. */
const partsBound = computed(() => {
  const bound = new Set<string>()
  const walk = (node: UidxNode): void => {
    const part = node.attrs.part?.value
    if (typeof part === 'string') bound.add(part)
    node.children.forEach(walk)
  }
  if (props.component) walk(props.component)
  return partsDeclared.value.filter((part) => bound.has(part.name)).length
})

const names = computed<ComponentNames>(() => props.config.headless?.bindings[name.value] ?? {})
const react = computed<ReactMapping | null>(() => props.config.codegen?.react[name.value] ?? null)

/** A kebab attribute name, as the code target spells a prop by default. */
const kebab = (text: string): string => text.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()
const pascal = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** Sets one entry of a name map; an empty value or the default removes it. */
function withEntry(
  map: Record<string, string> | undefined,
  key: string,
  value: string,
): Record<string, string> {
  const next = { ...(map ?? {}) }
  if (value.trim()) next[key] = value.trim()
  else delete next[key]
  return next
}

function saveNames(next: ComponentNames): void {
  emit('save', { key: 'binding', component: name.value, value: next })
}
function saveReact(next: ReactMapping | null): void {
  emit('save', { key: 'react', component: name.value, value: next })
}

function chooseElement(tag: string): void {
  if (props.component) emit('patches', setImplements(props.component, tag || null))
}

const reactOn = ref(false)
const showReact = computed(() => react.value !== null || reactOn.value)
const reactFrom = ref('')
function startReact(): void {
  if (!props.config.codegen) return
  reactOn.value = true
}
function setReactFrom(value: string): void {
  const from = value.trim()
  if (!from) {
    saveReact(null)
    reactOn.value = false
    return
  }
  saveReact({ ...(react.value ?? {}), from })
}
function toggleOmit(prop: string, omitted: boolean): void {
  const omit = new Set(react.value?.omit ?? [])
  if (omitted) omit.add(prop)
  else omit.delete(prop)
  saveReact({ ...react.value!, omit: [...omit] })
}

/* ------------------------------------------------------------- project */
const PROFILE: { key: string; label: string; options: [string, string][] }[] = [
  {
    key: 'props',
    label: 'Boolean props',
    options: [
      ['attribute', '[checked] attribute'],
      ['data-attribute', '[data-checked]'],
      ['class', '.checked class'],
    ],
  },
  {
    key: 'customStates',
    label: 'Custom states',
    options: [
      ['state', ':state(x)'],
      ['data-attribute', '[data-x]'],
      ['class', '.x class'],
    ],
  },
  {
    key: 'parts',
    label: 'Parts',
    options: [
      ['element', 'Elements of their own'],
      ['data-part', '[data-part="x"]'],
    ],
  },
]
function setProfile(key: string, value: string): void {
  const profile = { ...(props.config.headless?.profile ?? {}) }
  if (value === PROFILE.find((entry) => entry.key === key)!.options[0]![0]) delete profile[key]
  else profile[key] = value
  emit('save', { key: 'profile', value: Object.keys(profile).length ? profile : null })
}
const TARGETS: [string, string][] = [
  ['react', 'React'],
  ['html', 'HTML + CSS'],
  ['contract', 'Contract JSON'],
  ['cem', 'Custom Elements Manifest'],
  ['stories', 'Storybook stories'],
]
const outDraft = ref('')
function setOutput(out: string, targets?: string[]): void {
  const value = out.trim()
  if (!value) return
  emit('save', {
    key: 'codegen',
    value: {
      out: value,
      ...(targets
        ? { targets }
        : props.config.codegen?.targets
          ? { targets: props.config.codegen.targets }
          : {}),
    },
  })
}
function toggleTarget(target: string, on: boolean): void {
  const codegen = props.config.codegen
  if (!codegen) return
  const current = new Set(codegen.targets ?? ['html', 'react', 'contract'])
  if (on) current.add(target)
  else current.delete(target)
  setOutput(codegen.out, [...current])
}
const libraryPath = ref('')
</script>

<template>
  <section class="connect" aria-label="Connect to code">
    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <template v-if="component">
      <!-- Status: what this component is in code, at a glance. -->
      <div class="status-card" :data-connected="implementsTag !== '' || react !== null">
        <div class="status-line">
          <span class="dot" aria-hidden="true" />
          <strong>{{ name }}</strong>
          <span v-if="implementsTag || react" class="arrow">→</span>
          <code v-if="implementsTag">&lt;{{ names.tag || implementsTag }}&gt;</code>
          <code v-if="react">{{ react.export || name }} from {{ react.from }}</code>
          <span v-if="!implementsTag && !react" class="faint">not connected to code yet</span>
        </div>
        <p class="faint">{{ counts }}</p>
      </div>

      <!-- 1. The element: lives in the component's file. -->
      <section class="group" data-group="element">
        <header>
          <h4>Headless element</h4>
          <span class="where" title="Saved in the component's .uidx file">in {{ name }}.uidx</span>
        </header>
        <p class="hint">
          The web component or headless element that gives {{ name }} its behaviour and
          accessibility. Generated code renders it.
        </p>
        <select
          v-if="library"
          class="field"
          :value="implementsTag"
          :disabled="!writable"
          aria-label="Implements"
          @change="chooseElement(($event.target as HTMLSelectElement).value)"
        >
          <option value="">None</option>
          <option v-if="implementsTag && !element" :value="implementsTag">
            {{ implementsTag }} (not in the library)
          </option>
          <option v-for="root in library.roots" :key="root.tag" :value="root.tag">
            {{ root.tag }}
          </option>
        </select>
        <input
          v-else
          class="field"
          :value="implementsTag"
          :disabled="!writable"
          placeholder="x-button"
          aria-label="Implements"
          @change="chooseElement(($event.target as HTMLInputElement).value.trim())"
        />
        <p v-if="element?.description" class="hint">{{ element.description }}</p>
        <p v-if="partsDeclared.length" class="hint">
          {{ partsBound }} of {{ partsDeclared.length }} parts are bound to layers.
          <button type="button" class="link" @click="emit('openContract')">Bind parts</button>
        </p>
      </section>

      <!-- 2. The library's names: lives in uidx.json. -->
      <section v-if="implementsTag" class="group" data-group="names">
        <header>
          <h4>Names in the library</h4>
          <span class="where" title="Saved in uidx.json under headless.bindings">uidx.json</span>
        </header>
        <p class="hint">
          Only where the library spells something differently from the identity. Empty fields keep
          the identity's name.
        </p>
        <label class="pair">
          <span>Tag</span>
          <input
            class="field"
            :value="names.tag ?? ''"
            :placeholder="implementsTag"
            :disabled="!writable || !library"
            aria-label="Tag in the library"
            @change="
              saveNames({
                ...names,
                tag: ($event.target as HTMLInputElement).value.trim() || undefined,
              })
            "
          />
        </label>
        <div
          v-for="prop in propsList"
          :key="`attr:${prop.name}`"
          class="pair"
          :data-attribute="prop.name"
        >
          <code class="from">{{ prop.name }}</code>
          <input
            class="field"
            :value="names.attributes?.[prop.name] ?? ''"
            :placeholder="kebab(prop.name)"
            :list="element ? 'connect-attributes' : undefined"
            :disabled="!writable || !library"
            :aria-label="`Attribute for ${prop.name}`"
            @change="
              saveNames({
                ...names,
                attributes: withEntry(
                  names.attributes,
                  prop.name,
                  ($event.target as HTMLInputElement).value,
                ),
              })
            "
          />
        </div>
        <div
          v-for="event in events"
          :key="`event:${event.name}`"
          class="pair"
          :data-event="event.name"
        >
          <code class="from">{{ event.name }}</code>
          <input
            class="field"
            :value="names.events?.[event.name] ?? ''"
            :placeholder="event.name"
            :list="element ? 'connect-events' : undefined"
            :disabled="!writable || !library"
            :aria-label="`Event for ${event.name}`"
            @change="
              saveNames({
                ...names,
                events: withEntry(
                  names.events,
                  event.name,
                  ($event.target as HTMLInputElement).value,
                ),
              })
            "
          />
        </div>
        <datalist id="connect-attributes">
          <option
            v-for="attribute in element?.attributes ?? []"
            :key="attribute"
            :value="attribute"
          />
        </datalist>
        <datalist id="connect-events">
          <option v-for="item in element?.events ?? []" :key="item" :value="item" />
        </datalist>
        <p v-if="!library" class="hint">Choose the library below to rename against it.</p>
      </section>

      <!-- 3. An existing React component: lives in uidx.json. -->
      <section class="group" data-group="react">
        <header>
          <h4>Existing React component</h4>
          <span class="where" title="Saved in uidx.json under codegen.react">uidx.json</span>
        </header>
        <p class="hint">
          Render {{ name }} with a component your app already ships; the generated adapter maps the
          identity's props and events onto it.
        </p>
        <button
          v-if="!showReact"
          type="button"
          class="secondary"
          :disabled="!writable || !config.codegen"
          :title="config.codegen ? '' : 'Set the output folder below first'"
          data-action="map-react"
          @click="startReact"
        >
          Map to a React component
        </button>
        <template v-else>
          <label class="pair">
            <span>Module</span>
            <input
              class="field"
              :value="react?.from ?? reactFrom"
              placeholder="@acme/ui"
              :disabled="!writable"
              aria-label="Module"
              @change="setReactFrom(($event.target as HTMLInputElement).value)"
            />
          </label>
          <template v-if="react">
            <label class="pair">
              <span>Export</span>
              <input
                class="field"
                :value="react.export ?? ''"
                :placeholder="name"
                :disabled="!writable"
                aria-label="Export"
                @change="
                  saveReact({
                    ...react,
                    export: ($event.target as HTMLInputElement).value.trim() || undefined,
                  })
                "
              />
            </label>
            <div
              v-for="prop in propsList"
              :key="`rp:${prop.name}`"
              class="pair react-prop"
              :data-react-prop="prop.name"
            >
              <code class="from">{{ prop.name }}</code>
              <input
                class="field"
                :value="react.props?.[prop.name] ?? ''"
                :placeholder="prop.name"
                :disabled="!writable || react.omit?.includes(prop.name)"
                :aria-label="`React prop for ${prop.name}`"
                @change="
                  saveReact({
                    ...react,
                    props: withEntry(
                      react.props,
                      prop.name,
                      ($event.target as HTMLInputElement).value,
                    ),
                  })
                "
              />
              <label class="omit" :title="`Leave ${prop.name} out of the call`">
                <input
                  type="checkbox"
                  :checked="react.omit?.includes(prop.name) ?? false"
                  :disabled="!writable"
                  :aria-label="`Omit ${prop.name}`"
                  @change="toggleOmit(prop.name, ($event.target as HTMLInputElement).checked)"
                />
                omit
              </label>
            </div>
            <div
              v-for="event in events"
              :key="`re:${event.name}`"
              class="pair"
              :data-react-event="event.name"
            >
              <code class="from">{{ event.name }}</code>
              <input
                class="field"
                :value="react.events?.[event.name] ?? ''"
                :placeholder="`on${pascal(event.name)}`"
                :disabled="!writable"
                :aria-label="`React callback for ${event.name}`"
                @change="
                  saveReact({
                    ...react,
                    events: withEntry(
                      react.events,
                      event.name,
                      ($event.target as HTMLInputElement).value,
                    ),
                  })
                "
              />
            </div>
            <label class="pair">
              <span>Children</span>
              <select
                class="field"
                :value="react.children ?? ''"
                :disabled="!writable"
                aria-label="Children"
                @change="
                  saveReact({
                    ...react,
                    children: ($event.target as HTMLSelectElement).value || undefined,
                  })
                "
              >
                <option value="">
                  {{ slots.some((slot) => slot.name === 'default') ? 'default slot' : 'none' }}
                </option>
                <option v-for="prop in propsList" :key="`c:${prop.name}`" :value="prop.name">
                  {{ prop.name }}
                </option>
                <option v-for="slot in slots" :key="`s:${slot.name}`" :value="slot.name">
                  slot {{ slot.name }}
                </option>
              </select>
            </label>
            <button
              type="button"
              class="link danger"
              :disabled="!writable"
              @click="(saveReact(null), (reactOn = false))"
            >
              Remove mapping
            </button>
          </template>
        </template>
      </section>
    </template>
    <p v-else class="hint">Select a component, or a layer inside one, to connect it to code.</p>

    <!-- 4. The project: library, naming profile, output. -->
    <details class="group project" data-group="project" :open="!config.headless || !config.codegen">
      <summary>
        <h4>Project</h4>
        <span class="where">uidx.json · every component</span>
      </summary>

      <h5>Headless library</h5>
      <p v-if="config.headless" class="hint">
        <code>{{ config.headless.manifest }}</code>
        <template v-if="library"> · {{ library.roots.length }} elements</template>
      </p>
      <p v-else class="hint">No library yet: the custom-elements.json your components implement.</p>
      <div class="row">
        <select
          v-if="candidates?.length"
          class="field"
          :disabled="!writable"
          aria-label="Library from your dependencies"
          @change="emit('chooseLibrary', ($event.target as HTMLSelectElement).value)"
        >
          <option value="">From your dependencies…</option>
          <option v-for="candidate in candidates" :key="candidate.path" :value="candidate.path">
            {{ candidate.package }}
          </option>
        </select>
        <input
          v-model="libraryPath"
          class="field"
          :disabled="!writable"
          placeholder="node_modules/…/custom-elements.json"
          aria-label="Library path"
          @keydown.enter="libraryPath.trim() && emit('chooseLibrary', libraryPath.trim())"
        />
        <button
          type="button"
          class="secondary"
          :disabled="!writable || !libraryPath.trim()"
          @click="emit('chooseLibrary', libraryPath.trim())"
        >
          {{ config.headless ? 'Change' : 'Use' }}
        </button>
      </div>

      <template v-if="config.headless">
        <h5>How the library spells things</h5>
        <label v-for="entry in PROFILE" :key="entry.key" class="pair" :data-profile="entry.key">
          <span>{{ entry.label }}</span>
          <select
            class="field"
            :value="config.headless.profile[entry.key] ?? entry.options[0]![0]"
            :disabled="!writable"
            :aria-label="entry.label"
            @change="setProfile(entry.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="[value, label] in entry.options" :key="value" :value="value">
              {{ label }}
            </option>
          </select>
        </label>
      </template>

      <h5>Output</h5>
      <label class="pair">
        <span>Folder</span>
        <input
          class="field"
          :value="config.codegen?.out ?? outDraft"
          placeholder="src/ds"
          :disabled="!writable"
          aria-label="Output folder"
          @change="setOutput(($event.target as HTMLInputElement).value)"
        />
      </label>
      <div v-if="config.codegen" class="targets">
        <label v-for="[target, label] in TARGETS" :key="target" class="check" :data-target="target">
          <input
            type="checkbox"
            :checked="(config.codegen.targets ?? ['html', 'react', 'contract']).includes(target)"
            :disabled="!writable"
            @change="toggleTarget(target, ($event.target as HTMLInputElement).checked)"
          />
          {{ label }}
        </label>
      </div>
    </details>
  </section>
</template>

<style scoped>
.connect {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px var(--section-pad) 24px;
}
.status-card {
  display: grid;
  gap: 4px;
  padding: 12px;
  margin-bottom: 8px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--bg);
}
.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-faint);
}
.status-card[data-connected='true'] .dot {
  background: var(--ok);
}
.arrow {
  color: var(--text-faint);
}
code {
  font:
    11px ui-monospace,
    monospace;
  color: var(--bound);
}
.group {
  display: grid;
  gap: 6px;
  padding: 12px 0;
  border-top: 1px solid var(--line);
}
.group header,
.group summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.group summary {
  cursor: pointer;
  list-style: none;
}
.group summary::-webkit-details-marker {
  display: none;
}
h4 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
}
h5 {
  margin: 10px 0 2px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
}
.where {
  margin-left: auto;
  padding: 1px 6px;
  border-radius: 8px;
  background: var(--raised);
  color: var(--text-faint);
  font-size: 9px;
  white-space: nowrap;
}
.hint,
.faint {
  margin: 0;
  color: var(--text-faint);
  font-size: 11px;
  line-height: 1.5;
}
.error {
  margin: 0 0 8px;
  color: var(--danger);
  font-size: 11px;
}
.field {
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  background: var(--raised);
  color: var(--text);
  font: inherit;
}
.field:focus {
  border-color: var(--accent);
  outline: 0;
}
.pair {
  display: grid;
  grid-template-columns: 92px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}
.pair.react-prop {
  grid-template-columns: 92px minmax(0, 1fr) auto;
}
.pair > span {
  color: var(--text-dim);
  font-size: 11px;
}
.from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row {
  display: flex;
  gap: 6px;
}
.omit,
.check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--text-dim);
  font-size: 11px;
}
.targets {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 8px;
}
.secondary {
  justify-self: start;
  padding: 5px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 11px;
  white-space: nowrap;
  cursor: pointer;
}
.secondary:disabled {
  opacity: 0.5;
  cursor: default;
}
.link {
  justify-self: start;
  padding: 0;
  border: 0;
  background: none;
  color: var(--accent);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.link.danger {
  color: var(--danger);
}
</style>
