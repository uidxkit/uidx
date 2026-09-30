<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  declarationOf,
  type ContractKind,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  bindPart,
  contractView,
  declare,
  isPlaceholder,
  PLACEHOLDER,
  scaffoldFromLibrary,
  setImplements,
  setPart,
  moveRepeatOnto,
  setReceives,
  setRepeat,
  setRepeatAs,
  undeclare,
} from './contract-edits'
import type { ModelIndex } from '@uidx/schema'
import type { HeadlessCandidate, HeadlessLibrary } from './headless'
import { LAYER_ICONS, REPEAT_ICON, STROKE_ICONS } from './layer-icons'

/**
 * The Contract tab: where the visual tree is bound to its code render
 * (ADR 0013 §3, ADR 0017 §2).
 *
 * The Design tab says what a thing looks like; this one says what it *is* to
 * the headless library — which element a component implements, which part a
 * layer draws, which list a layer repeats over. Figma keeps the same split
 * between its Design panel and the properties it links to code, and it binds
 * from both ends: a property is declared on the component and applied from
 * the layer. So does this. A part is bound from the component's list or from
 * the layer's own row, and both write the same attribute.
 *
 * Choices come from a list wherever one exists — the library's roots, the
 * root's parts, the contract's list props — and from a text field only
 * when the document has no library to ask. Nothing here edits the contract's
 * prose; that is the file's, and the tab shows it so the binding can be read
 * against what it binds to.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode | null
  library: HeadlessLibrary | null
  libraryError?: string
  /** Libraries the project's dependencies ship, offered while none is named. */
  candidates?: HeadlessCandidate[]
  /** Where generated code goes, when uidx.json says (`codegen.out`), and how the last run went. */
  codegen?: { out: string | null; running: boolean; notice: string }
  /** Model name -> declaration across every page, so a list's model resolves wherever it is written. */
  models?: ModelIndex
  /** Component name -> definition across every page, for what an instance receives. */
  components?: ReadonlyMap<string, UidxNode>
  writable: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  /** Jump the selection to a layer the tab names, as clicking it in the rail would. */
  select: [address: string]
  /** Name the library the document uses; the server writes it into uidx.json. */
  chooseLibrary: [path: string]
  /** Open the Models face on the model a repeat draws (ADR 0015 §1). */
  openModel: [name: string]
  /** Render the code targets into `codegen.out` on the server. */
  generateCode: []
}>()

/** The library's tag for the selected component, when `uidx.json` binds one (ADR 0013 §3). */
const boundTag = computed(() => {
  if (view.value.kind !== 'component') return null
  return props.library?.bindings[view.value.component.name]?.tag ?? null
})

const otherPath = ref('')
function chooseCandidate(path: string): void {
  if (path) emit('chooseLibrary', path)
}

const view = computed(() =>
  contractView(props.doc, props.node, props.library, props.models, props.components),
)

const boundCount = computed(() =>
  view.value.kind === 'component' ? view.value.parts.filter((row) => row.boundTo).length : 0,
)

const contract = computed(() =>
  view.value.kind === 'component' ? (view.value.component.spec?.contract ?? null) : null,
)

function send(patches: UidxPatch[]): void {
  if (patches.length) emit('patches', patches)
}

function chooseElement(tag: string): void {
  if (view.value.kind !== 'component') return
  send(setImplements(view.value.component, tag || null))
}

function bind(part: string, address: string): void {
  if (view.value.kind !== 'component' || !props.doc || !address) return
  send(bindPart(props.doc, view.value.component, part, address))
}

function unbind(address: string): void {
  if (!props.doc) return
  const node = findNode(props.doc.tree, address)
  if (node) send(setPart(node, null))
}

function choosePart(part: string): void {
  if (view.value.kind !== 'part') return
  send(setPart(view.value.node, part || null))
}

/**
 * The repeat rows (ADR 0017 §2) belong to any layer inside a component: a
 * part, a slot, or an instance repeats the same way, so one block serves the
 * three views rather than each carrying its own.
 */
const repeatable = computed(() => {
  const current = view.value
  return current.kind === 'part' || current.kind === 'slot' || current.kind === 'instance'
    ? current
    : null
})

function chooseRepeat(list: string): void {
  if (!repeatable.value) return
  send(setRepeat(repeatable.value.node, list || null))
}

function chooseAs(raw: string): void {
  if (!repeatable.value) return
  send(setRepeatAs(repeatable.value.node, raw))
}

/** The repeat moves from the container onto the row it holds; the row is then selected. */
function repeatRowInstead(): void {
  const current = repeatable.value
  if (!current?.wrapsOne || !props.doc) return
  const row = findNode(props.doc.tree, current.wrapsOne.address)
  if (!row) return
  send(moveRepeatOnto(current.node, row))
  emit('select', row.address)
}

/** What an instance hands one of its definition's props; empty leaves the inference to stand. */
function chooseReceives(prop: string, alias: string): void {
  if (view.value.kind !== 'instance') return
  send(setReceives(view.value.node, prop, alias || null))
}

/** A `<Slot>` in the tree the contract does not declare yet, declared in one click. */
function declareSlot(name: string): void {
  send(declare('slot', name, { attrs: {}, description: `${PLACEHOLDER}the slot "${name}".` }))
}

function findNode(root: UidxNode, address: string): UidxNode | null {
  if (root.address === address) return root
  for (const child of root.children) {
    const found = findNode(child, address)
    if (found) return found
  }
  return null
}

/** `'  '`-indented so the picker reads as the layer tree does. */
const indent = (depth: number): string => '  '.repeat(depth)

/* ------------------------------------------------ editing the contract */

/** Which declaration's editor is open, as `kind:name`. */
const open = ref<string | null>(null)
function toggle(key: string): void {
  open.value = open.value === key ? null : key
}

const addKind = ref<ContractKind>('prop')
const addName = ref('')

/** `{ checked: boolean }` as typed; a JSON value where it parses, the text otherwise. */
function parsed(text: string): JsonValue | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    return trimmed
  }
}
const printed = (value: JsonValue | undefined): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value)

/** Rewrites one declaration with some of its attributes or its description changed. */
function redeclare(
  kind: ContractKind,
  name: string,
  change: { attrs?: Record<string, JsonValue | undefined>; description?: string },
): void {
  if (!props.doc) return
  const current = declarationOf(props.doc, kind, name) ?? { attrs: {}, description: '' }
  const attrs: Record<string, JsonValue> = { ...current.attrs }
  for (const [key, value] of Object.entries(change.attrs ?? {})) {
    if (value === undefined || value === false) delete attrs[key]
    else attrs[key] = value
  }
  // A boolean prop is an axis the moment it is visual (ADR 0016 §1), and an
  // axis needs a default to order its values by; one retyped to boolean
  // gets `false` unless the form said otherwise.
  if (kind === 'prop' && change.attrs?.type === 'boolean' && attrs.default === undefined)
    attrs.default = false
  const description =
    change.description === undefined || change.description === ''
      ? current.description
      : change.description
  send(declare(kind, name, { attrs, description }))
}

function remove(kind: ContractKind, name: string): void {
  send(undeclare(kind, name))
  if (open.value === `${kind}:${name}`) open.value = null
}

/** The type a new prop gets; a boolean is a state the moment it is visual, so it comes with a default. */
const addType = ref<'string' | 'number' | 'boolean'>('string')

function add(): void {
  const name = addName.value.trim()
  if (!name) return
  const kind = addKind.value
  const attrs: Record<string, JsonValue> =
    kind === 'prop'
      ? addType.value === 'boolean'
        ? { type: 'boolean', default: false }
        : { type: addType.value }
      : {}
  send(declare(kind, name, { attrs, description: `${PLACEHOLDER}the ${kind} "${name}".` }))
  addName.value = ''
  open.value = `${kind}:${name}`
}

/** Declares what the element exposes and the contract lacks (ADR 0013 §5). */
function fill(): void {
  if (view.value.kind !== 'component' || !view.value.element) return
  send(scaffoldFromLibrary(view.value.component, view.value.element))
}

/** A visual boolean is drawn as a state of the set (ADR 0016 §1); the list says so. */
const isState = (prop: { type: string; visual: boolean }): boolean =>
  prop.visual && prop.type === 'boolean'
</script>

<template>
  <section class="contract" aria-label="Contract">
    <!-- Nothing selected: what the tab is for, and whether a library is loaded. -->
    <template v-if="view.kind === 'page'">
      <p class="empty">
        Select a component to declare what its instances can change — properties, slots and states —
        or a layer inside one to name the part it draws.
      </p>
    </template>

    <template v-else-if="view.kind === 'component'">
      <header class="head">
        <span class="title">Properties</span>
        <span class="of">of {{ view.component.name }}</span>
        <button
          v-if="view.element"
          type="button"
          class="stale-name fill"
          :disabled="!writable"
          title="Declare what the element exposes and the contract lacks: attributes as props, events, slots, parts"
          @click="fill"
        >
          Fill from library
        </button>
      </header>
      <p v-if="!contract" class="empty">
        Nothing declared yet. A property is what an instance can change without reaching inside; a
        slot is where it can put its own content. Add one below.
      </p>

      <!-- Props -->
      <template v-for="prop in contract?.props ?? []" :key="`prop:${prop.name}`">
        <div class="row read" :data-prop="prop.name" :data-draft="isPlaceholder(prop.description)">
          <button
            type="button"
            class="name open"
            :aria-expanded="open === `prop:${prop.name}`"
            :title="prop.description"
            @click="toggle(`prop:${prop.name}`)"
          >
            <span class="name-text">{{ prop.name }}</span>
            <span
              v-if="isState(prop)"
              class="pill"
              title="A visual boolean: drawn as a state of the set, styled by a state row"
              >state</span
            >
            <span v-if="isPlaceholder(prop.description)" class="flag" title="Needs a description"
              >?</span
            >
          </button>
          <span class="type" :title="prop.type">{{ prop.type }}</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Remove prop ${prop.name}`"
            @click="remove('prop', prop.name)"
          >
            ×
          </button>
        </div>
        <div v-if="open === `prop:${prop.name}`" class="form" :data-editor="`prop:${prop.name}`">
          <label class="field">
            <span>Description</span>
            <input
              class="text"
              :value="isPlaceholder(prop.description) ? '' : prop.description"
              :placeholder="prop.description"
              :disabled="!writable"
              @change="
                redeclare('prop', prop.name, {
                  description: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </label>
          <label class="field">
            <span>Type</span>
            <input
              class="text"
              :value="prop.type"
              aria-label="Type"
              :disabled="!writable"
              @change="
                redeclare('prop', prop.name, {
                  attrs: { type: ($event.target as HTMLInputElement).value.trim() },
                })
              "
            />
          </label>
          <div class="pair">
            <label class="field">
              <span>Default</span>
              <input
                class="text"
                :value="printed(prop.default)"
                aria-label="Default"
                :disabled="!writable"
                placeholder="none"
                @change="
                  redeclare('prop', prop.name, {
                    attrs: { default: parsed(($event.target as HTMLInputElement).value) },
                  })
                "
              />
            </label>
            <label class="field">
              <span>Sample</span>
              <input
                class="text"
                :value="printed(prop.sample)"
                aria-label="Sample"
                :disabled="!writable"
                placeholder="none"
                @change="
                  redeclare('prop', prop.name, {
                    attrs: { sample: parsed(($event.target as HTMLInputElement).value) },
                  })
                "
              />
            </label>
          </div>
          <div class="flags">
            <label
              ><input
                type="checkbox"
                aria-label="Visual"
                :checked="prop.visual"
                :disabled="!writable"
                @change="
                  redeclare('prop', prop.name, {
                    attrs: { visual: ($event.target as HTMLInputElement).checked },
                  })
                "
              />
              Visual</label
            >
            <label
              ><input
                type="checkbox"
                aria-label="Controllable"
                :checked="prop.controllable"
                :disabled="!writable"
                @change="
                  redeclare('prop', prop.name, {
                    attrs: { controllable: ($event.target as HTMLInputElement).checked },
                  })
                "
              />
              Controllable</label
            >
          </div>
        </div>
      </template>

      <!-- Events -->
      <template v-for="event in contract?.events ?? []" :key="`event:${event.name}`">
        <div
          class="row read"
          :data-event="event.name"
          :data-draft="isPlaceholder(event.description)"
        >
          <button
            type="button"
            class="name open"
            :aria-expanded="open === `event:${event.name}`"
            :title="event.description"
            @click="toggle(`event:${event.name}`)"
          >
            <span class="name-text">on {{ event.name }}</span>
            <span v-if="isPlaceholder(event.description)" class="flag" title="Needs a description"
              >?</span
            >
          </button>
          <span class="type">{{ event.detail ?? 'event' }}</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Remove event ${event.name}`"
            @click="remove('event', event.name)"
          >
            ×
          </button>
        </div>
        <div v-if="open === `event:${event.name}`" class="form">
          <label class="field">
            <span>Description</span>
            <input
              class="text"
              :value="isPlaceholder(event.description) ? '' : event.description"
              :placeholder="event.description"
              :disabled="!writable"
              @change="
                redeclare('event', event.name, {
                  description: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </label>
          <label class="field">
            <span>Detail type</span>
            <input
              class="text"
              :value="event.detail ?? ''"
              :disabled="!writable"
              placeholder="{ checked: boolean }"
              @change="
                redeclare('event', event.name, {
                  attrs: { detail: ($event.target as HTMLInputElement).value.trim() || undefined },
                })
              "
            />
          </label>
        </div>
      </template>

      <!-- Declared slots -->
      <template v-for="slot in contract?.slots ?? []" :key="`slot:${slot.name}`">
        <div
          class="row read"
          :data-declared-slot="slot.name"
          :data-draft="isPlaceholder(slot.description)"
        >
          <button
            type="button"
            class="name open"
            :aria-expanded="open === `slot:${slot.name}`"
            :title="slot.description"
            @click="toggle(`slot:${slot.name}`)"
          >
            <span class="name-text">slot {{ slot.name }}</span>
            <span v-if="isPlaceholder(slot.description)" class="flag" title="Needs a description"
              >?</span
            >
          </button>
          <span class="type">{{ slot.accepts ? `accepts ${slot.accepts}` : 'slot' }}</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Remove slot ${slot.name}`"
            @click="remove('slot', slot.name)"
          >
            ×
          </button>
        </div>
        <div v-if="open === `slot:${slot.name}`" class="form">
          <label class="field">
            <span>Description</span>
            <input
              class="text"
              :value="isPlaceholder(slot.description) ? '' : slot.description"
              :placeholder="slot.description"
              :disabled="!writable"
              @change="
                redeclare('slot', slot.name, {
                  description: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </label>
          <div class="pair">
            <label class="field">
              <span>Accepts (element)</span>
              <input
                class="text"
                :value="slot.accepts ?? ''"
                :disabled="!writable"
                placeholder="hwc-radio"
                @change="
                  redeclare('slot', slot.name, {
                    attrs: {
                      accepts: ($event.target as HTMLInputElement).value.trim() || undefined,
                    },
                  })
                "
              />
            </label>
          </div>
        </div>
      </template>

      <!-- Element states and described parts -->
      <template v-for="state in contract?.states ?? []" :key="`state:${state.name}`">
        <div
          class="row read"
          :data-state="state.name"
          :data-draft="isPlaceholder(state.description)"
        >
          <button
            type="button"
            class="name open"
            :aria-expanded="open === `state:${state.name}`"
            :title="state.description"
            @click="toggle(`state:${state.name}`)"
          >
            <span class="name-text">{{ state.name }}</span>
            <span class="pill" title="A state the element produces itself, styled through :state()"
              >element</span
            >
          </button>
          <span class="type">state</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Remove state ${state.name}`"
            @click="remove('state', state.name)"
          >
            ×
          </button>
        </div>
        <div v-if="open === `state:${state.name}`" class="form">
          <label class="field">
            <span>Description</span>
            <input
              class="text"
              :value="isPlaceholder(state.description) ? '' : state.description"
              :placeholder="state.description"
              :disabled="!writable"
              @change="
                redeclare('state', state.name, {
                  description: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </label>
        </div>
      </template>
      <template v-for="part in contract?.parts ?? []" :key="`part:${part.name}`">
        <div
          class="row read"
          :data-described-part="part.name"
          :data-draft="isPlaceholder(part.description)"
        >
          <button
            type="button"
            class="name open"
            :aria-expanded="open === `part:${part.name}`"
            :title="part.description"
            @click="toggle(`part:${part.name}`)"
          >
            <span class="name-text">part {{ part.name }}</span>
            <span v-if="isPlaceholder(part.description)" class="flag" title="Needs a description"
              >?</span
            >
          </button>
          <span class="type">part</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Remove part ${part.name}`"
            @click="remove('part', part.name)"
          >
            ×
          </button>
        </div>
        <div v-if="open === `part:${part.name}`" class="form">
          <label class="field">
            <span>Description</span>
            <input
              class="text"
              :value="isPlaceholder(part.description) ? '' : part.description"
              :placeholder="part.description"
              :disabled="!writable"
              @change="
                redeclare('part', part.name, {
                  description: ($event.target as HTMLInputElement).value.trim(),
                })
              "
            />
          </label>
        </div>
      </template>

      <!-- Add a declaration -->
      <div class="row add" :class="{ typed: addKind === 'prop' }" data-field="add-declaration">
        <select v-model="addKind" class="pick" :disabled="!writable" aria-label="Kind to add">
          <option value="prop">Prop</option>
          <option value="event">Event</option>
          <option value="slot">Slot</option>
          <option value="state">State</option>
          <option value="part">Part</option>
        </select>
        <input
          v-model="addName"
          class="text"
          :disabled="!writable"
          aria-label="Name to add"
          placeholder="name"
          @keydown.enter="add"
        />
        <select
          v-if="addKind === 'prop'"
          v-model="addType"
          class="pick narrow"
          :disabled="!writable"
          aria-label="Type to add"
          title="A boolean comes with default={false}; make it visual to design it as a state"
        >
          <option value="string">text</option>
          <option value="number">number</option>
          <option value="boolean">boolean</option>
        </select>
        <button
          type="button"
          class="reset"
          :disabled="!writable || !addName.trim()"
          aria-label="Add declaration"
          title="Declare it; describe it after"
          @click="add"
        >
          +
        </button>
      </div>

      <template v-if="view.slots.length || view.straySlots.length">
        <header class="head"><span class="title">Slots</span></header>
        <div
          v-for="stray in view.straySlots"
          :key="`stray:${stray.address}`"
          class="row"
          :data-stray-slot="stray.name"
          data-bound="false"
        >
          <span class="name">{{ stray.name }}</span>
          <button
            type="button"
            class="layer"
            title="Select the slot"
            @click="emit('select', stray.address)"
          >
            <span class="layer-name">Not declared</span>
          </button>
          <button
            type="button"
            class="stale-name"
            :disabled="!writable"
            :title="`Declare slot ${stray.name} in the contract`"
            @click="declareSlot(stray.name)"
          >
            Declare
          </button>
        </div>
        <div
          v-for="slot in view.slots"
          :key="slot.name"
          class="row"
          :data-slot="slot.name"
          :data-bound="slot.provided !== null"
        >
          <span class="name">
            {{ slot.name }}
            <span
              v-if="slot.provided?.repeat"
              class="pill"
              :title="`Repeats over {${slot.provided.repeat.list}}: consumers fill one per item`"
              >repeats</span
            >
          </span>
          <button
            v-if="slot.provided"
            type="button"
            class="layer"
            title="Select the slot"
            @click="emit('select', slot.provided.address)"
          >
            <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                :d="slot.provided.repeat ? REPEAT_ICON : LAYER_ICONS.Slot"
                fill="none"
                stroke="currentColor"
                stroke-width="1"
              />
            </svg>
            <span class="layer-name">
              {{ slot.provided.repeat ? 'Slot, one per item' : 'Slot in tree' }}
            </span>
          </button>
          <span v-else class="status">No slot in the tree yet</span>
          <span class="reset-spacer" />
        </div>
      </template>

      <!--
        How the component reaches code. A designer never needs this; a
        developer binding the render to a headless element opens it. Closed by
        default so the tab leads with what instances can change.
      -->
      <details class="code-binding" data-field="code-binding" :open="view.implementsValue !== null">
        <summary>
          <span class="title">Code binding</span>
          <span class="of">{{
            view.implementsValue ? view.implementsValue : 'optional · for developers'
          }}</span>
        </summary>
        <header class="head">
          <span class="title">Implements</span>
          <span class="of">{{ view.component.name }}</span>
        </header>
        <div class="row" data-field="implements" :data-set="view.implementsValue !== null">
          <span class="name" title="The headless element this component is a render of">
            Element
          </span>
          <select
            v-if="library"
            class="pick"
            :value="view.implementsValue ?? ''"
            :disabled="!writable"
            aria-label="Element"
            @change="chooseElement(($event.target as HTMLSelectElement).value)"
          >
            <option value="">None</option>
            <option v-for="option in view.rootOptions" :key="option.tag" :value="option.tag">
              {{ option.tag }}{{ option.known ? '' : ' · not in library' }}
            </option>
          </select>
          <input
            v-else
            class="text"
            :value="view.implementsValue ?? ''"
            :disabled="!writable"
            aria-label="Element"
            placeholder="e.g. hwc-button"
            @change="chooseElement(($event.target as HTMLInputElement).value.trim())"
          />
          <button
            v-if="view.implementsValue !== null"
            type="button"
            class="reset"
            :disabled="!writable"
            aria-label="Clear element"
            title="Implement nothing"
            @click="chooseElement('')"
          >
            ↺
          </button>
          <span v-else class="reset-spacer" />
        </div>
        <p v-if="boundTag && boundTag !== view.implementsValue" class="hint" data-field="bound">
          Rendered as <code>{{ boundTag }}</code> — uidx.json binds this component to it.
        </p>
        <p v-if="view.element" class="hint">
          <template v-if="view.element.attributes.length">
            Attributes: {{ view.element.attributes.join(', ') }}.
          </template>
          <template v-if="view.element.events.length">
            Events: {{ view.element.events.join(', ') }}.
          </template>
        </p>

        <header class="head">
          <span class="title">Parts</span>
          <span v-if="view.parts.length" class="of"
            >{{ boundCount }} of {{ view.parts.length }} bound</span
          >
        </header>
        <p v-if="!view.parts.length" class="empty">
          <template v-if="view.implementsValue === null">
            Choose an element above to see the parts it offers.
          </template>
          <template v-else-if="!view.element">
            “{{ view.implementsValue }}” is not in the library, and the contract declares no parts.
          </template>
          <template v-else>“{{ view.implementsValue }}” has no parts to bind.</template>
        </p>
        <!--
        Bound from the component's side (Figma declares a property here) — each
        declared part is a row, and an unbound row is a picker over the layers
        that could draw it. A bound row names its layer and jumps to it.
      -->
        <div
          v-for="row in view.parts"
          :key="row.name"
          class="row"
          :data-part="row.name"
          :data-bound="row.boundTo !== null"
        >
          <span
            class="name"
            :title="
              `${row.name} · ` +
              (row.declaredBy === 'both'
                ? 'declared by the library and the contract'
                : row.declaredBy === 'library'
                  ? 'declared by the library'
                  : 'declared by the contract; the library does not know it')
            "
          >
            {{ row.name }}
            <span v-if="row.declaredBy === 'contract' && view.element" class="flag">?</span>
            <span
              v-if="row.kind === 'shadow'"
              class="pill"
              title="A shadow part: styled through ::part() and drawn by the library. What the bound layer holds stays design-only."
              >shadow</span
            >
          </span>
          <button
            v-if="row.boundTo"
            type="button"
            class="layer"
            :title="`Select ${row.boundTo.name}`"
            @click="emit('select', row.boundTo.address)"
          >
            <svg class="icon" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                :d="LAYER_ICONS[row.boundTo.element as keyof typeof LAYER_ICONS]"
                :fill="STROKE_ICONS.has(row.boundTo.element as never) ? 'none' : 'currentColor'"
                :stroke="STROKE_ICONS.has(row.boundTo.element as never) ? 'currentColor' : 'none'"
                stroke-width="1"
              />
            </svg>
            <span class="layer-name">{{ row.boundTo.name }}</span>
          </button>
          <select
            v-else
            class="pick unbound"
            value=""
            :disabled="!writable || !view.candidates.length"
            :aria-label="`Bind ${row.name}`"
            @change="bind(row.name, ($event.target as HTMLSelectElement).value)"
          >
            <option value="" disabled>
              {{ view.candidates.length ? 'Bind a layer…' : 'No layer to bind' }}
            </option>
            <option v-for="c in view.candidates" :key="c.address" :value="c.address">
              {{ indent(c.depth) }}{{ c.name }}
            </option>
          </select>
          <button
            v-if="row.boundTo"
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Unbind ${row.name}`"
            :title="`Unbind ${row.boundTo.name} from ${row.name}`"
            @click="unbind(row.boundTo.address)"
          >
            ×
          </button>
          <span v-else class="reset-spacer" />
        </div>
        <p v-for="stray in view.strayParts" :key="stray.address" class="stale" role="status">
          “{{ stray.name }}” is bound to “{{ stray.part }}”, which nothing declares.
          <button type="button" class="stale-name" @click="emit('select', stray.address)">
            Show it
          </button>
        </p>
      </details>
    </template>

    <template v-else-if="view.kind === 'part'">
      <header class="head">
        <span class="title">Part</span>
        <span class="of">of {{ view.component.name }}</span>
      </header>
      <p v-if="view.undeclared" class="empty">
        {{ view.component.name }} implements no element yet, so there is no part for this layer to
        draw.
        <button type="button" class="stale-name" @click="emit('select', view.component.address)">
          Select {{ view.component.name }}
        </button>
      </p>
      <!--
        Bound from the layer's side (Figma applies a property here). Parts held
        by another layer stay listed and say who has them: a part is bound once,
        and seeing where it went beats a list that silently shrinks.
      -->
      <div v-else class="row" data-field="part" :data-set="view.partValue !== null">
        <span class="name" title="The part of the headless element this layer draws">Draws</span>
        <select
          class="pick"
          :value="view.partValue ?? ''"
          :disabled="!writable"
          aria-label="Part"
          @change="choosePart(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Nothing — design only</option>
          <option
            v-for="option in view.options"
            :key="option.name"
            :value="option.name"
            :disabled="option.takenBy !== null"
          >
            {{ option.name }}{{ option.kind === 'shadow' ? ' · shadow' : ''
            }}{{ option.takenBy ? ` · bound to ${option.takenBy}` : '' }}
          </option>
        </select>
        <button
          v-if="view.partValue !== null"
          type="button"
          class="reset"
          :disabled="!writable"
          aria-label="Clear part"
          title="Design only: draws no part"
          @click="choosePart('')"
        >
          ↺
        </button>
        <span v-else class="reset-spacer" />
      </div>
    </template>

    <template v-else-if="view.kind === 'slot'">
      <header class="head">
        <span class="title">Slot</span>
        <span v-if="view.component" class="of">of {{ view.component.name }}</span>
      </header>
      <p v-if="view.declared" class="hint">
        “{{ view.node.name }}” is declared by the contract<template v-if="view.declared.accepts">
          ; each filling is an {{ view.declared.accepts }}</template
        >. Consumers fill it; what is inside is the placeholder<template v-if="view.repeat">
          , drawn once per item</template
        >.
      </p>
      <p v-else class="stale" role="status">
        The contract does not declare a slot called “{{ view.node.name }}”. Add it under
        <code>&lt;Slots&gt;</code>, or rename this one.
      </p>
    </template>

    <template v-else-if="view.kind === 'derived'">
      <header class="head">
        <span class="title">State</span>
        <span class="of">{{ view.state }}</span>
      </header>
      <p class="empty">
        This is {{ view.component.name }} in the {{ view.state }} state, drawn from its styles
        table. Bindings live on the base layer.
        <button type="button" class="stale-name" @click="emit('select', view.base.address)">
          Select {{ view.base.name }}
        </button>
      </p>
    </template>

    <template v-else-if="view.kind === 'instance'">
      <header class="head">
        <span class="title">Instance</span>
        <span v-if="view.definition" class="of">of {{ view.definition.name }}</span>
      </header>
      <p v-if="!view.definition" class="stale" role="status">
        This document has no component called “{{ view.node.attrs.component?.value }}”.
      </p>
      <p v-else-if="!view.component" class="hint">
        An instance renders its component's contract. Inside a component it also receives what the
        component or an enclosing repeat hands it.
      </p>
      <template v-else-if="view.receives.length">
        <!--
          Inside a repeat, the row's item is what the instance is of (ADR 0017
          §2): a prop typed by the item's model receives the item without a
          word written, as the code target passes it. The rows say what each
          prop receives, mark what was inferred, and let the use say otherwise.
        -->
        <header class="head"><span class="title">Receives</span></header>
        <div
          v-for="row in view.receives"
          :key="row.prop"
          class="row"
          :data-receives="row.prop"
          :data-set="row.from !== null"
          :data-inferred="!row.explicit && row.from !== null"
        >
          <span class="name" :title="row.type">{{ row.prop }}</span>
          <select
            v-if="row.options.length"
            class="pick"
            :value="row.explicit ? row.from : ''"
            :disabled="!writable"
            :aria-label="`${row.prop} receives`"
            @change="chooseReceives(row.prop, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">
              {{ row.from && !row.explicit ? '{' + row.from + '} · inferred' : 'Nothing' }}
            </option>
            <option v-for="option in row.options" :key="option" :value="option">
              {{ '{' + option + '}' }}
            </option>
          </select>
          <span v-else class="type" :title="`Nothing in scope is a ${row.type}`">
            {{ row.from ? '{' + row.from + '}' : 'nothing in scope' }}
          </span>
          <button
            v-if="row.explicit"
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Reset ${row.prop}`"
            title="Back to what the repeat implies"
            @click="chooseReceives(row.prop, '')"
          >
            ↺
          </button>
          <span v-else class="reset-spacer" />
        </div>
        <p class="hint">
          <button type="button" class="stale-name" @click="emit('select', view.definition.address)">
            Select {{ view.definition.name }}
          </button>
          to change what it declares.
        </p>
      </template>
      <p v-else class="hint">
        {{ view.definition.name }} declares no contract props.
        <button type="button" class="stale-name" @click="emit('select', view.definition.address)">
          Select it
        </button>
        to add some.
      </p>
    </template>

    <template v-else>
      <p class="empty">
        Only layers inside a component draw a part. Move this layer into a component, or make one
        from it.
      </p>
    </template>

    <!--
      Repeating is per layer (ADR 0017 §2), the way Vue's v-for and Plasmic's
      "repeat this element" are: any layer inside a component may draw itself
      once per item of a list, and its parent is the outer structure. So the
      rows sit below whichever view the layer has, not in a view of their own.
    -->
    <template v-if="repeatable && repeatable.component">
      <header class="head">
        <span class="title">Repeat</span>
        <span
          v-if="repeatable.repeat"
          class="of"
          title="Rows the canvas draws: one per sample of the model, three when it has none"
          >× {{ repeatable.repeat.rows }}</span
        >
      </header>
      <div class="row" data-field="repeat" :data-set="repeatable.repeat !== null">
        <span class="name" title="The list this layer draws one of itself per item of">Over</span>
        <select
          v-if="repeatable.lists.length"
          class="pick"
          :value="repeatable.repeat?.list ?? ''"
          :disabled="!writable"
          aria-label="Repeat over"
          @change="chooseRepeat(($event.target as HTMLSelectElement).value)"
        >
          <option value="">Once</option>
          <option
            v-if="repeatable.repeat && !repeatable.lists.includes(repeatable.repeat.list)"
            :value="repeatable.repeat.list"
          >
            {{ '{' + repeatable.repeat.list + '}' }} · not a list here
          </option>
          <option v-for="list in repeatable.lists" :key="list" :value="list">
            {{ '{' + list + '}' }}
          </option>
        </select>
        <input
          v-else
          class="text"
          :value="repeatable.repeat?.list ?? ''"
          :disabled="!writable"
          aria-label="Repeat over"
          placeholder="once"
          @change="chooseRepeat(($event.target as HTMLInputElement).value.trim())"
        />
        <button
          v-if="repeatable.repeat"
          type="button"
          class="reset"
          :disabled="!writable"
          aria-label="Clear repeat"
          title="Draw it once"
          @click="chooseRepeat('')"
        >
          ↺
        </button>
        <span v-else class="reset-spacer" />
      </div>
      <template v-if="repeatable.repeat">
        <div class="row" data-field="as" :data-set="repeatable.repeat.as !== 'item'">
          <span class="name" title="The item's name in the bindings below, like {item.name}"
            >As</span
          >
          <input
            class="text"
            :value="repeatable.repeat.as"
            :disabled="!writable"
            aria-label="Item name"
            placeholder="item"
            @change="chooseAs(($event.target as HTMLInputElement).value)"
          />
          <span class="reset-spacer" />
        </div>
        <p v-if="repeatable.wrapsOne" class="stale" role="status">
          This repeats the whole “{{ repeatable.node.name }}”, one per item, with “{{
            repeatable.wrapsOne.name
          }}” inside each. To keep one container and repeat the row:
          <button type="button" class="stale-name" :disabled="!writable" @click="repeatRowInstead">
            Repeat {{ repeatable.wrapsOne.name }} instead
          </button>
        </p>
        <p v-if="repeatable.repeat.model && !repeatable.repeat.unknownModel" class="hint">
          Each item is a
          <button
            type="button"
            class="stale-name"
            :title="`Open ${repeatable.repeat.model} on the Models face`"
            @click="emit('openModel', repeatable.repeat.model)"
          >
            {{ repeatable.repeat.model }}
          </button>
          ; bind text below to <code>{{ '{' + repeatable.repeat.as + '.field}' }}</code
          >.
        </p>
        <p v-else-if="repeatable.repeat.model" class="stale" role="status">
          Each item is a {{ repeatable.repeat.model }}, which no page declares under
          <code>## Models</code>.
          <button
            type="button"
            class="stale-name"
            :disabled="!writable"
            @click="emit('openModel', repeatable.repeat.model)"
          >
            Declare it
          </button>
        </p>
        <p v-else class="stale" role="status">
          The contract cannot place <code>{{ '{' + repeatable.repeat.list + '}' }}</code
          >: declare it as a list prop, or as a list field of the outer item.
        </p>
      </template>
      <p v-else-if="!repeatable.lists.length" class="hint">
        To repeat this layer, declare a list prop under <code>## Contract</code> — say
        <code>items</code> of type <code>Contact[]</code>.
      </p>
    </template>

    <!-- Where the choices come from, on every view: a fact the author can act on. -->
    <p v-if="libraryError" class="stale library" role="status">{{ libraryError }}</p>
    <div v-else-if="library" class="library">
      <p>Library: {{ library.path }} · {{ library.roots.length }} elements</p>
      <div v-if="codegen?.out" class="row" data-field="generate">
        <span class="name" :title="`Into ${codegen.out}, as uidx codegen would`">Code</span>
        <button
          type="button"
          class="layer generate"
          :disabled="!writable || codegen.running"
          :title="`Render HTML/CSS and React into ${codegen.out}`"
          @click="emit('generateCode')"
        >
          {{ codegen.running ? 'Generating…' : `Generate → ${codegen.out}` }}
        </button>
        <span class="reset-spacer" />
      </div>
      <p v-if="codegen?.notice" class="faint" role="status" data-field="generate-notice">
        {{ codegen.notice }}
      </p>
    </div>
    <details v-else class="library code-binding" data-field="choose-library">
      <summary>
        <span class="title">Code library</span>
        <span class="of">optional · for developers</span>
      </summary>
      <p>
        Connect a component library so the code binding can pick elements and parts from a list.
      </p>
      <div v-if="candidates?.length" class="row">
        <span class="name">From a dependency</span>
        <select
          class="pick unbound"
          value=""
          :disabled="!writable"
          aria-label="Choose a library"
          @change="chooseCandidate(($event.target as HTMLSelectElement).value)"
        >
          <option value="" disabled>Choose…</option>
          <option v-for="c in candidates" :key="c.path" :value="c.path">{{ c.package }}</option>
        </select>
        <span class="reset-spacer" />
      </div>
      <div class="row">
        <span class="name">Or a path</span>
        <input
          v-model="otherPath"
          class="text"
          :disabled="!writable"
          aria-label="Library path"
          placeholder="…/custom-elements.json"
          @keydown.enter="chooseCandidate(otherPath.trim())"
        />
        <button
          type="button"
          class="reset"
          :disabled="!writable || !otherPath.trim()"
          aria-label="Use this library"
          title="Write it into uidx.json"
          @click="chooseCandidate(otherPath.trim())"
        >
          ✓
        </button>
      </div>
      <p class="faint">Written into uidx.json as <code>"headless"</code>, relative to it.</p>
    </details>
  </section>
</template>

<style scoped>
.contract {
  padding: var(--pad);
}
.code-binding {
  margin-top: 16px;
  border-top: 1px solid var(--line);
}
.code-binding > summary {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 10px 0 4px;
  cursor: pointer;
  list-style: none;
}
.code-binding > summary::-webkit-details-marker {
  display: none;
}
.code-binding > summary::before {
  content: '›';
  display: inline-block;
  width: 10px;
  color: var(--text-dim);
  transition: transform 120ms;
}
.code-binding[open] > summary::before {
  transform: rotate(90deg);
}
.head {
  display: flex;
  align-items: baseline;
  gap: var(--gap-sm);
  height: var(--row-h);
}
.head + .head,
.row + .head,
.hint + .head,
.empty + .head,
.stale + .head {
  margin-top: 8px;
}
.title {
  color: var(--text);
  font-weight: 600;
}
.of {
  color: var(--bound);
  font-size: var(--ui-size-sm);
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 24px;
  align-items: center;
  gap: var(--gap);
  min-height: var(--field-h);
  padding: 4px 0;
}
.name {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-sm);
  overflow: hidden;
  color: var(--text-dim);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row[data-set='true'] .name,
.row[data-bound='true'] .name {
  color: var(--text);
}
.text,
.pick {
  height: var(--field-h);
  min-width: 0;
  padding: 0 6px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--text);
  font: inherit;
}
.pick {
  width: 100%;
  cursor: pointer;
  color-scheme: dark;
}
.row[data-set='false'] .pick,
.row[data-set='false'] .text {
  color: var(--text-faint);
}
.pick.unbound {
  color: var(--text-faint);
  border-style: dashed;
  border-color: var(--line);
  background: none;
}
.layer {
  display: inline-flex;
  align-items: center;
  gap: var(--gap-sm);
  min-width: 0;
  height: var(--field-h);
  padding: 0 8px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  color: var(--bound);
  font: inherit;
  cursor: pointer;
}
.layer:hover {
  border-color: var(--bound);
}
.layer .icon {
  flex: none;
}
.layer-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type,
.status {
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.row.read {
  min-height: var(--row-h);
  padding: 2px 0;
}
.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pill {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--raised);
  color: var(--text-dim);
  font-size: 10px;
  font-weight: 500;
}
.flag {
  color: var(--warn);
  font-size: 10px;
}
.reset,
.stale-name {
  min-width: 24px;
  min-height: 24px;
  padding: 0 4px;
  background: none;
  border: none;
  border-radius: var(--radius);
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.reset:hover:not(:disabled),
.stale-name:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.reset-spacer {
  width: 24px;
}
.stale-name {
  color: var(--warn);
  text-decoration: underline;
}
.empty,
.hint,
.stale,
.library {
  margin: 0;
  padding-top: var(--gap-sm);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  line-height: 1.5;
}
.stale {
  color: var(--warn);
}
.library {
  margin-top: 16px;
  padding-top: 8px;
  border-top: 1px solid var(--line);
}
code {
  font-family: var(--mono-font, ui-monospace, monospace);
  font-size: 10px;
}
.library p {
  margin: 0 0 4px;
}
.name.open {
  padding: 0;
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.name.open[aria-expanded='true'] .name-text {
  color: var(--bound);
}
.row[data-draft='true'] .name-text {
  color: var(--warn);
}
.fill {
  margin-left: auto;
}
.form {
  display: grid;
  gap: 6px;
  margin: 0 0 8px;
  padding: 8px;
  background: var(--bg);
  border-radius: var(--radius-lg);
}
.field {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.field > span {
  color: var(--text-dim);
  font-size: 10px;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.flags {
  display: flex;
  gap: 12px;
  color: var(--text-dim);
}
.flags input {
  margin: 0 4px 0 0;
}
.row.add {
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) 24px;
  margin-top: 4px;
}
.row.add.typed {
  grid-template-columns: minmax(0, 0.7fr) minmax(0, 1fr) minmax(0, 0.7fr) 24px;
}
.pick.narrow {
  min-width: 0;
}
.faint {
  color: var(--text-faint);
  font-size: 10px;
}
</style>
