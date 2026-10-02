<script lang="ts">
/**
 * The last focus request served, across mounts. The shell keeps its request
 * after switching to this tab, so a later remount must not take it as new;
 * `n` is what makes each request new.
 */
let servedFocus = 0
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { UidxDocument, UidxNode, UidxPatch } from '@uidx/format'
import type { HeadlessCandidate, HeadlessLibrary } from './headless'
import type { ComponentNames, ConfigChange, ConnectionConfig, ReactMapping } from './headless'
import { declaredParts, setImplements } from './contract-edits'
import { FieldIcon } from './field-icons'
import InspectorSection from './InspectorSection.vue'
import {
  ACTION,
  COPY,
  INFO,
  firstSentence,
  plainText,
  type MessageAction,
} from './inspector-messages'

/**
 * The Connect tab: how a component's identity reaches code, managed in one
 * place (ADR 0013 §3, ADR 0017 §3). Builder calls this component mapping.
 *
 * Four sections in the Design tab's grammar — the element, the library's
 * names, an existing React component, and the project — each saying in its
 * (i) where its values are saved: the element the component implements and
 * the parts its layers bind live in the component's `.uidx` file; the
 * library's names, the React component, the naming profile and where code
 * goes live in `uidx.json`. One footnote says the same for the whole tab.
 *
 * Faults are not drawn here. A library that cannot be read or a `uidx.json`
 * that cannot be loaded is the shell's status line; this tab only keeps its
 * controls steady meanwhile, and shows a refused value under its field.
 * The Code tab renders from all of it.
 */
const props = defineProps<{
  doc: UidxDocument | null
  /** The component being connected: the selection, or the one it sits in. */
  component: UidxNode | null
  library: HeadlessLibrary | null
  candidates?: HeadlessCandidate[]
  config: ConnectionConfig
  writable: boolean
  /** 'of Button' when the selection is a layer inside the component. */
  relation?: string | null
  /** The status line's 'Choose library' or 'Set folder': open Project at that field. */
  focus?: { target: 'library' | 'output'; n: number } | null
  /** `uidx.json` names a library the server could not read; the status line says why. */
  libraryFailed?: boolean
  /** A change to `uidx.json` the server refused, worded for the field it came from. */
  fieldError?: { key: ConfigChange['key']; text: string } | null
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  save: [change: ConfigChange]
  chooseLibrary: [path: string]
  openContract: []
  act: [action: MessageAction]
}>()

const section = ref<HTMLElement | null>(null)

const name = computed(() => props.component?.name ?? '')
const contract = computed(() => props.component?.spec?.contract)
const propsList = computed(() => contract.value?.props ?? [])
const events = computed(() => contract.value?.events ?? [])
const slots = computed(() => contract.value?.slots ?? [])

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/* ------------------------------------------------------------- element */
const implementsTag = computed(() => {
  const value = props.component?.attrs.implements?.value
  return typeof value === 'string' ? value : ''
})
const element = computed(() =>
  implementsTag.value ? (props.library?.elements.get(implementsTag.value) ?? null) : null,
)
/**
 * The picker is a list whenever a library is configured, loaded or not, so
 * the control never changes type while the library loads or fails; a typed
 * tag is only for projects with no library at all.
 */
const pickFromList = computed(() => props.library !== null || props.config.headless !== null)

// The Contract tab's list: what the library's element offers and what the
// contract declares, so the two tabs never count different parts.
const partsDeclared = computed(() =>
  props.component ? declaredParts(props.component, element.value ?? null) : [],
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
/**
 * '2/6 parts bound', or nothing: no parts is not progress, and while the
 * library is unreadable the count would leave out its parts, so the status
 * line's "checks are paused" stands alone.
 */
const partsLine = computed(() =>
  partsDeclared.value.length && !props.libraryFailed
    ? COPY.partsProgress(partsBound.value, partsDeclared.value.length)
    : '',
)

const description = computed(() => element.value?.description ?? '')
const summary = computed(() => firstSentence(description.value))
const fullDescription = computed(() => plainText(description.value))
const moreOpen = ref(false)
watch(element, () => {
  moreOpen.value = false
})

function chooseElement(tag: string): void {
  if (props.component) emit('patches', setImplements(props.component, tag || null))
}

/* --------------------------------------------------------------- names */
const names = computed<ComponentNames>(() => props.config.headless?.bindings[name.value] ?? {})
/** How many names this section sets: the tag, attributes and events it shows. */
const namesSet = computed(
  () =>
    (names.value.tag ? 1 : 0) +
    Object.keys(names.value.attributes ?? {}).length +
    Object.keys(names.value.events ?? {}).length,
)

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

/* --------------------------------------------------------------- react */
const react = computed<ReactMapping | null>(() => props.config.codegen?.react[name.value] ?? null)

function saveReact(next: ReactMapping | null): void {
  emit('save', { key: 'react', component: name.value, value: next })
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
function removeReact(): void {
  saveReact(null)
  reactOn.value = false
}

/*
 * Names and React open when they hold something. The reader's own toggle
 * then wins: a value arriving (uidx.json loading, a save landing) opens its
 * section, but clearing the last one never snaps it shut mid-edit. Another
 * component starts over, and drops a half-started React mapping.
 */
const namesOpen = ref(false)
const reactOpen = ref(false)
watch(
  name,
  () => {
    namesOpen.value = namesSet.value > 0
    reactOpen.value = react.value !== null
    reactOn.value = false
    reactFrom.value = ''
  },
  { immediate: true },
)
watch(
  () => namesSet.value > 0,
  (set) => {
    if (set) namesOpen.value = true
  },
)
watch(
  () => react.value !== null,
  (mapped) => {
    if (mapped) reactOpen.value = true
  },
)

/* ------------------------------------------------------------- project */
/** Open while the project lacks a library or an output folder; the reader's toggle after that. */
const projectOpen = ref(!props.config.headless || !props.config.codegen)
const editLibrary = ref(false)
const libraryPath = ref('')

/**
 * What a person calls the library: its npm package without the scope, else
 * the folder holding a conventional `custom-elements.json`, else the file.
 * The configured path is always in the title.
 */
const libraryName = computed(() => {
  const manifest = props.config.headless?.manifest ?? ''
  const pkg = /node_modules\/(?:@[^/]+\/)?([^/]+)/.exec(manifest)?.[1]
  if (pkg) return pkg
  const parts = manifest.split(/[\\/]/).filter((part) => part && part !== '.' && part !== '..')
  const file = parts.at(-1) ?? manifest
  return file === 'custom-elements.json' && parts.length > 1 ? parts.at(-2)! : file
})
const elementCount = computed(() =>
  props.libraryFailed
    ? 'Unavailable'
    : props.library
      ? plural(props.library.roots.length, 'element')
      : '',
)
const projectMeta = computed(() => {
  if (!props.config.headless) return props.config.codegen ? 'No library' : 'Not set up'
  if (props.libraryFailed) return 'Library unavailable'
  return [libraryName.value, elementCount.value].filter(Boolean).join(' · ')
})

function chooseLibrary(path: string): void {
  const value = path.trim()
  if (!value) return
  emit('chooseLibrary', value)
  editLibrary.value = false
}

/**
 * The naming profile, with short option labels that fit two columns; the
 * long form is each option's title, and the select's for the chosen one.
 */
const PROFILE: { key: string; label: string; options: [string, string, string][] }[] = [
  {
    key: 'props',
    label: 'Boolean props',
    options: [
      ['attribute', 'Attribute', '[checked] attribute'],
      ['data-attribute', 'data-attribute', '[data-checked]'],
      ['class', 'Class', '.checked class'],
    ],
  },
  {
    key: 'customStates',
    label: 'Custom states',
    options: [
      ['state', ':state()', ':state(x)'],
      ['data-attribute', 'data-attribute', '[data-x]'],
      ['class', 'Class', '.x class'],
    ],
  },
  {
    key: 'parts',
    label: 'Parts',
    options: [
      ['element', 'Own element', 'Elements of their own'],
      ['data-part', 'data-part', '[data-part="x"]'],
    ],
  },
  {
    key: 'coverage',
    label: 'Coverage',
    options: [
      ['full', 'Full', 'Every attribute and event'],
      ['subset', 'Subset', 'A chosen subset (general library)'],
    ],
  },
]
const profileValue = (entry: (typeof PROFILE)[number]): string =>
  props.config.headless?.profile[entry.key] ?? entry.options[0]![0]
const profileTitle = (entry: (typeof PROFILE)[number]): string | undefined =>
  entry.options.find(([value]) => value === profileValue(entry))?.[2]
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

/*
 * The status line's 'Choose library' and 'Set folder' land here: Project
 * opens at the field and focuses it. Immediate, because the shell switches
 * to this tab and asks in the same tick, before this component exists.
 */
watch(
  () => props.focus,
  async (focus) => {
    if (!focus || focus.n === servedFocus) return
    servedFocus = focus.n
    projectOpen.value = true
    if (focus.target === 'library' && props.config.headless) editLibrary.value = true
    await nextTick()
    const label = focus.target === 'library' ? 'Library path' : 'Output folder'
    const field = section.value?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
    field?.scrollIntoView?.({ block: 'center' })
    field?.focus({ preventScroll: true })
  },
  { immediate: true },
)
</script>

<template>
  <section ref="section" class="connect" aria-label="Connect to code">
    <template v-if="component">
      <!-- 1. The element: lives in the component's file. -->
      <InspectorSection
        group="element"
        title="Headless element"
        :meta="relation ?? undefined"
        :info="INFO.element(name)"
      >
        <div class="body">
          <select
            v-if="pickFromList"
            class="field"
            :value="implementsTag"
            :disabled="!writable"
            aria-label="Implements"
            @change="chooseElement(($event.target as HTMLSelectElement).value)"
          >
            <option value="">None</option>
            <template v-if="library">
              <option v-if="implementsTag && !element" :value="implementsTag">
                {{ COPY.notInLibrary(implementsTag) }}
              </option>
              <option v-for="entry in library.roots" :key="entry.tag" :value="entry.tag">
                {{ entry.tag }}
              </option>
            </template>
            <option v-else-if="implementsTag" :value="implementsTag">
              {{ libraryFailed ? COPY.libraryUnavailable(implementsTag) : implementsTag }}
            </option>
          </select>
          <template v-else>
            <input
              class="field"
              :value="implementsTag"
              :disabled="!writable"
              placeholder="x-button"
              aria-label="Implements"
              @change="chooseElement(($event.target as HTMLInputElement).value.trim())"
            />
            <p class="hint">
              {{ COPY.noLibrary }}
              <button type="button" class="link-button" @click="emit('act', ACTION.chooseLibrary)">
                {{ ACTION.chooseLibrary.label }}
              </button>
            </p>
          </template>
          <div v-if="implementsTag && library && !element" class="issue" role="status">
            <span class="tone-dot" data-tone="warn" />
            <span>{{ COPY.tagMissing(implementsTag) }}</span>
          </div>
          <div v-if="description" class="description">
            <p class="hint clamp" :class="{ open: moreOpen }" :title="fullDescription">
              {{ moreOpen ? fullDescription : summary }}
            </p>
            <button
              v-if="fullDescription !== summary"
              type="button"
              class="link-button"
              :aria-expanded="moreOpen"
              @click="moreOpen = !moreOpen"
            >
              {{ moreOpen ? 'Less' : 'More' }}
            </button>
          </div>
          <p v-if="partsLine" class="kv" data-field="parts-progress">
            <span class="value">{{ partsLine }}</span>
            <button type="button" class="link-button" @click="emit('openContract')">
              Bind parts
            </button>
          </p>
        </div>
      </InspectorSection>

      <!-- 2. The library's names: lives in uidx.json. -->
      <InspectorSection
        v-if="implementsTag"
        group="names"
        title="Names in the library"
        collapsible
        :open="namesOpen"
        :meta="namesSet ? `${namesSet} set` : undefined"
        :info="INFO.names"
        @toggle="namesOpen = $event"
      >
        <div class="body">
          <p v-if="library" class="hint">Leave empty to keep the same name.</p>
          <p v-else-if="!libraryFailed && !config.headless" class="hint">
            {{ COPY.noLibrary }}
            <button type="button" class="link-button" @click="emit('act', ACTION.chooseLibrary)">
              {{ ACTION.chooseLibrary.label }}
            </button>
          </p>
          <label class="pair">
            <code class="from">tag</code>
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
            <code class="from" :title="prop.name">{{ prop.name }}</code>
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
            <code class="from" :title="event.name">{{ event.name }}</code>
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
          <p v-if="fieldError?.key === 'binding'" class="field-error" role="alert">
            {{ fieldError.text }}
          </p>
        </div>
      </InspectorSection>

      <!-- 3. An existing React component: lives in uidx.json. -->
      <InspectorSection
        group="react"
        title="React component"
        collapsible
        :open="reactOpen"
        :meta="react ? react.export || name : undefined"
        :info="INFO.react(name)"
        @toggle="reactOpen = $event"
      >
        <template v-if="react" #actions>
          <button
            type="button"
            class="cluster-btn"
            :disabled="!writable"
            aria-label="Remove mapping"
            title="Remove mapping"
            @click="removeReact"
          >
            <FieldIcon name="trash" />
          </button>
        </template>
        <div class="body">
          <template v-if="!showReact">
            <button
              type="button"
              class="btn block"
              :disabled="!writable || !config.codegen"
              :title="config.codegen ? undefined : COPY.needsOutput"
              data-action="map-react"
              @click="startReact"
            >
              Map to a React component
            </button>
            <p v-if="!config.codegen" class="field-help">
              {{ COPY.needsOutput }}
              <button type="button" class="link-button" @click="emit('act', ACTION.setFolder)">
                {{ ACTION.setFolder.label }}
              </button>
            </p>
          </template>
          <template v-else>
            <label class="stack">
              <span class="caption">Module</span>
              <input
                class="field"
                :value="react?.from ?? reactFrom"
                placeholder="@acme/ui"
                :disabled="!writable"
                :aria-invalid="fieldError?.key === 'react' || undefined"
                aria-label="Module"
                @change="setReactFrom(($event.target as HTMLInputElement).value)"
              />
            </label>
            <p v-if="fieldError?.key === 'react'" class="field-error" role="alert">
              {{ fieldError.text }}
            </p>
            <template v-if="react">
              <label class="stack">
                <span class="caption">Export</span>
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
                class="pair mapped"
                :data-react-prop="prop.name"
              >
                <code class="from" :title="prop.name">{{ prop.name }}</code>
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
                  <span class="sr-only">omit</span>
                </label>
              </div>
              <div
                v-for="event in events"
                :key="`re:${event.name}`"
                class="pair mapped"
                :data-react-event="event.name"
              >
                <code class="from" :title="event.name">{{ event.name }}</code>
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
              <label class="stack">
                <span class="caption">Children</span>
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
            </template>
          </template>
        </div>
      </InspectorSection>
    </template>

    <!-- 4. The project: library, naming profile, output. -->
    <InspectorSection
      group="project"
      field="project"
      collapsible
      title="Project"
      :open="projectOpen"
      :meta="projectMeta"
      :meta-title="config.headless?.manifest"
      :info="INFO.project"
      @toggle="projectOpen = $event"
    >
      <div class="body">
        <header class="subhead">Library</header>
        <div v-if="config.headless" class="kv" data-field="library">
          <span v-if="libraryFailed" class="tone-dot" data-tone="warn" />
          <span class="value" :title="config.headless.manifest">{{ libraryName }}</span>
          <span v-if="elementCount" class="meta">{{ elementCount }}</span>
          <button
            type="button"
            class="btn compact"
            :disabled="!writable"
            :aria-expanded="editLibrary"
            @click="editLibrary = !editLibrary"
          >
            {{ editLibrary ? 'Cancel' : 'Change…' }}
          </button>
        </div>
        <template v-if="!config.headless || editLibrary">
          <select
            v-if="candidates?.length"
            class="field"
            :disabled="!writable"
            aria-label="Library from your dependencies"
            @change="chooseLibrary(($event.target as HTMLSelectElement).value)"
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
            @keydown.enter="chooseLibrary(libraryPath)"
          />
          <button
            type="button"
            class="btn block"
            :disabled="!writable || !libraryPath.trim()"
            @click="chooseLibrary(libraryPath)"
          >
            Use library
          </button>
        </template>

        <template v-if="config.headless">
          <header class="subhead">Naming</header>
          <div class="grid2">
            <label
              v-for="entry in PROFILE"
              :key="entry.key"
              class="stack"
              :data-profile="entry.key"
            >
              <span class="caption">{{ entry.label }}</span>
              <select
                class="field"
                :value="profileValue(entry)"
                :title="profileTitle(entry)"
                :disabled="!writable"
                :aria-label="entry.label"
                @change="setProfile(entry.key, ($event.target as HTMLSelectElement).value)"
              >
                <option
                  v-for="[value, label, title] in entry.options"
                  :key="value"
                  :value="value"
                  :title="title"
                >
                  {{ label }}
                </option>
              </select>
            </label>
          </div>
        </template>

        <header class="subhead">Output</header>
        <label class="stack">
          <span class="caption">Folder</span>
          <input
            class="field"
            :value="config.codegen?.out ?? outDraft"
            placeholder="src/ds"
            :disabled="!writable"
            :aria-invalid="fieldError?.key === 'codegen' || undefined"
            aria-label="Output folder"
            @change="setOutput(($event.target as HTMLInputElement).value)"
          />
        </label>
        <p v-if="fieldError?.key === 'codegen'" class="field-error" role="alert">
          {{ fieldError.text }}
        </p>
        <div v-if="config.codegen" class="targets" role="group" aria-label="Targets">
          <span class="caption" aria-hidden="true">Targets</span>
          <label
            v-for="[target, label] in TARGETS"
            :key="target"
            class="check"
            :data-target="target"
          >
            <input
              type="checkbox"
              :checked="(config.codegen.targets ?? ['html', 'react', 'contract']).includes(target)"
              :disabled="!writable"
              @change="toggleTarget(target, ($event.target as HTMLInputElement).checked)"
            />
            {{ label }}
          </label>
        </div>
      </div>
    </InspectorSection>

    <p v-if="component" class="footnote">{{ COPY.footnote(name) }}</p>
  </section>
</template>

<style scoped>
.connect {
  display: block;
  padding: 0 0 24px;
}
/* Every section body: one column of rows, 8px apart, as the Design tab. */
.body {
  display: grid;
  gap: 8px;
  min-width: 0;
}
code {
  font: 11px var(--mono-font);
  color: var(--text-dim);
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
  text-overflow: ellipsis;
}
/* The native arrow brings its own room; the text keeps the inputs' 8px inset. */
select.field {
  padding-right: 2px;
}
.field:hover:not(:disabled) {
  border-color: var(--line);
}
.field:focus {
  border-color: var(--accent);
  outline: 0;
}
.field[aria-invalid='true'] {
  border-color: var(--danger);
}
.field:disabled {
  opacity: 0.5;
  cursor: default;
}
/* A refused value sits right under its field, not a row away. */
.body > .field-error {
  margin-top: -4px;
}
.subhead {
  margin: 4px 0 -4px;
  color: var(--text-dim);
  font-weight: 600;
}
.subhead:first-child {
  margin-top: 0;
}
/* A caption above its control. */
.stack {
  display: grid;
  gap: 4px;
  min-width: 0;
}
.caption {
  overflow: hidden;
  color: var(--text-dim);
  font-size: var(--ui-size);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
/* A name in the identity, then the library's spelling of it. */
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  align-items: center;
  gap: 8px;
}
/* React rows keep a third column for a prop's omit box, so every input lines up. */
.pair.mapped {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 24px;
}
.from {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.omit {
  display: flex;
  align-items: center;
  justify-content: center;
}
/* A value, a faint note, and its action at the far end. */
.kv {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 28px;
  margin: 0;
}
.kv .value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.kv[data-field='parts-progress'] .value {
  color: var(--text-dim);
}
.kv .meta {
  flex: none;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.kv > :is(.btn, .link-button) {
  flex: none;
  margin-left: auto;
}
.hint {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.hint > .link-button,
.field-help > .link-button {
  margin-left: 2px;
}
.clamp:not(.open) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.description {
  display: grid;
  justify-items: start;
  gap: 2px;
}
.description > .link-button {
  font-size: var(--ui-size-sm);
}
.field-help {
  margin: -4px 0 0;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.targets {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
}
.check {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  color: var(--text);
}
.footnote {
  margin: 12px 0;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
</style>
