<script lang="ts">
/**
 * The last focus request served, across mounts. Switching tabs remounts the
 * section with the shell's last request still set; one already served must
 * not open and scroll the tab again.
 */
let served = 0
</script>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  declarationOf,
  enumValues,
  listProps,
  STATE_AXIS,
  type ContractKind,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  bindPart,
  bindPartsByName,
  contractProblems,
  contractView,
  declare,
  isPlaceholder,
  PLACEHOLDER,
  libraryOffers,
  scaffoldOffers,
  type LibraryOffer,
  setPart,
  undeclare,
} from './contract-edits'
import type { ModelIndex } from '@uidx/schema'
import type { HeadlessLibrary } from './headless'
import { LAYER_ICONS, REPEAT_ICON, STROKE_ICONS } from './layer-icons'
import { renameContractProp } from './contract-rename'
import {
  ABOUT,
  ACTION,
  COPY,
  EMPTY,
  INFO,
  SLOT_OUTSIDE,
  instanceEmpty,
  slotFill,
  type EmptyCopy,
  type MessageAction,
} from './inspector-messages'
import { parentOf } from './layer-moves'
import InspectorEmpty from './InspectorEmpty.vue'
import InspectorSection from './InspectorSection.vue'
import SlotSettingsSection from './SlotSettingsSection.vue'

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
 *
 * The tab declares and binds; it does not configure. Which library the
 * project uses is Connect's, and writing code is Code's: the tab links to
 * Connect (`act`) when no library is set rather than carrying a second
 * chooser, and leaves Write to the Code tab beside it. A library that cannot
 * be read is said once, in the shell's status line; here the checks that
 * need it say they are paused.
 */
const props = defineProps<{
  doc: UidxDocument | null
  node: UidxNode | null
  library: HeadlessLibrary | null
  libraryError?: string
  /** Model name -> declaration across every page, so a list's model resolves wherever it is written. */
  models?: ModelIndex
  /** Component name -> definition across every page, for what an instance receives. */
  components?: ReadonlyMap<string, UidxNode>
  /** Every page and this one's file, so a prop rename can carry the instances that set it. */
  pages?: ReadonlyMap<string, UidxDocument>
  file?: string
  writable: boolean
  /** The shell asking to show the parts: a status line's Show, or Code's Open contract. */
  focus?: { target: 'parts'; n: number } | null
  /** Whether the selection can be made a component, for the empty states' action. */
  canMakeComponent?: boolean
}>()

const emit = defineEmits<{
  patches: [patches: UidxPatch[]]
  /** Jump the selection to a layer the tab names, as clicking it in the rail would. */
  select: [address: string]
  /** Open the Models face on the model a repeat draws (ADR 0015 §1). */
  openModel: [name: string]
  /** What another face or the shell does: open Connect › Project, show a component, make one. */
  act: [action: MessageAction]
  /**
   * Library spellings for members just declared under the identity's names
   * (`helpText` → `help-text`), for the shell to merge into uidx.json.
   */
  bindNames: [
    component: string,
    names: { attributes: Record<string, string>; events: Record<string, string> },
  ]
  /** An edit that lands in several files: a prop rename and every instance it carries. */
  remap: [byFile: ReadonlyMap<string, UidxPatch[]>]
  refused: [reason: string]
}>()

function renameProp(from: string, to: string): void {
  if (!to.trim() || to.trim() === from || !props.file) return
  const pages = props.pages ?? (props.doc ? new Map([[props.file, props.doc]]) : new Map())
  const plan = renameContractProp(pages, props.file, from, to)
  if ('refused' in plan) {
    emit('refused', plan.refused)
    return
  }
  open.value = `prop:${to.trim()}`
  emit('remap', plan.byFile)
}

/** The library's tag for the selected component, when `uidx.json` binds one (ADR 0013 §3). */
const boundTag = computed(() => {
  if (view.value.kind !== 'component') return null
  return props.library?.bindings[view.value.component.name]?.tag ?? null
})

const view = computed(() =>
  contractView(props.doc, props.node, props.library, props.models, props.components),
)

/**
 * The library was configured but could not be read. Part checks need it, so
 * they say they are paused instead of reporting every binding as unknown;
 * the shell's status line carries the fault itself.
 */
const paused = computed(() => !!props.libraryError)

const boundCount = computed(() =>
  view.value.kind === 'component' ? view.value.parts.filter((row) => row.boundTo).length : 0,
)

/**
 * Every part is a shadow part, as in any custom-elements.json library: a pill
 * on each row would say nothing and cost the name its room, so the rows say
 * it in their title and the pill is kept for a list that mixes kinds.
 */
const allShadow = computed(
  () =>
    view.value.kind === 'component' &&
    view.value.parts.length > 0 &&
    view.value.parts.every((row) => row.kind === 'shadow'),
)

const contract = computed(() =>
  view.value.kind === 'component' ? (view.value.component.spec?.contract ?? null) : null,
)

/**
 * Everything the contract declares, for the empty hint. The section's count
 * is its props alone: events, slots, states and parts each count under their
 * own subhead, so "Properties 10" never means four properties.
 */
const declCount = computed(() => {
  const c = contract.value
  return c
    ? c.props.length + c.events.length + c.slots.length + c.states.length + c.parts.length
    : 0
})

const counted = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/** '22 attributes · 3 events' for the implemented element, the full lists in its title. */
const members = computed(() => {
  if (view.value.kind !== 'component' || !view.value.element) return null
  const { attributes, events } = view.value.element
  if (!attributes.length && !events.length) return null
  return {
    text: [
      attributes.length ? counted(attributes.length, 'attribute') : '',
      events.length ? counted(events.length, 'event') : '',
    ]
      .filter(Boolean)
      .join(' · '),
    title: [
      attributes.length ? `Attributes: ${attributes.join(', ')}.` : '',
      events.length ? `Events: ${events.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  }
})

/** `N` slots, and how many of them no Slot layer draws yet. */
const slotsMeta = computed(() => {
  if (view.value.kind !== 'component') return undefined
  const total = view.value.slots.length + view.value.straySlots.length
  const notDrawn = view.value.slots.filter((slot) => slot.provided === null).length
  return notDrawn ? `${total} · ${notDrawn} not drawn` : String(total)
})

/** A part layer's value the implemented element does not offer: codegen stops on it. */
const badPart = computed(
  () =>
    !paused.value && view.value.kind === 'part' && contractProblems(view.value, props.library) > 0,
)
/** The element a part layer's component implements, for its warning. */
const partTag = computed(() => {
  const tag = view.value.kind === 'part' ? view.value.component.attrs.implements?.value : null
  return typeof tag === 'string' ? tag : ''
})

/** The empty states' one way forward, when the shell says the selection can become a component. */
const makeComponent = computed(() => (props.canMakeComponent ? ACTION.makeComponent : undefined))

/**
 * The component whose slot the selected `<Slot>` fills. A fill sits in an
 * instance, not a component (ADR 0007 §2), so it has no contract here; it
 * is not "outside a component" either, and making its frame one cannot work.
 */
const fillOf = computed(() => {
  if (view.value.kind !== 'slot' || view.value.component || !props.doc) return null
  const owner = parentOf(props.doc, view.value.node.address)
  const name = owner?.element === 'Instance' ? owner.attrs.component?.value : null
  return typeof name === 'string' && name ? name : null
})

/**
 * A fill's empty state: whose slot it fills, and a way there when that
 * component is defined in the project.
 */
const fillEmpty = computed((): (EmptyCopy & { action?: MessageAction }) | null => {
  const component = fillOf.value
  if (!component || view.value.kind !== 'slot') return null
  const { action, ...copy } = slotFill(component, view.value.node.name)
  return { ...copy, ...(!props.components || props.components.has(component) ? { action } : {}) }
})

/* ------------------------------------------------ focus from the shell */

const root = ref<HTMLElement | null>(null)
const bindingSection = ref<InstanceType<typeof InspectorSection> | null>(null)
/** Code binding opened on request; otherwise it is open while an element is set. */
const bindingOpen = ref(false)

/**
 * Brings the parts into view when the shell asks — a contract warning's
 * Show, or a Code diagnostic's Open contract. They live in Code binding,
 * which is folded until an element is chosen, so it opens first. A part
 * layer has no such section; its own warning row is shown instead.
 */
async function reveal(focus: { target: 'parts'; n: number } | null | undefined): Promise<void> {
  if (!focus || focus.n === served) return
  served = focus.n
  bindingOpen.value = true
  await nextTick()
  // Opened by hand and closed again, the prop alone would not reopen it.
  bindingSection.value?.show()
  const binding = root.value?.querySelector<HTMLElement>('[data-field="code-binding"]')
  const target = binding ?? root.value?.querySelector('.issue')
  target?.scrollIntoView?.({ block: 'start' })
}
watch(() => props.focus, reveal, { immediate: true })

/** The bindings Bind by name would make: unbound parts whose names a layer carries. */
const byName = computed(() =>
  view.value.kind === 'component' && props.doc
    ? bindPartsByName(props.doc, view.value.component, view.value.parts)
    : [],
)

function send(patches: UidxPatch[]): void {
  if (patches.length) emit('patches', patches)
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
    // `visual` and `controllable` are flags written only when on; any other
    // attribute keeps a `false` it is given (a boolean's default, a sample).
    if (value === undefined || (value === false && (key === 'visual' || key === 'controllable')))
      delete attrs[key]
    else attrs[key] = value
  }
  // A boolean prop is an axis the moment it is visual (ADR 0016 §1), and an
  // axis needs a default to order its values by; one retyped to boolean
  // gets `false` unless the form said otherwise.
  if (kind === 'prop' && change.attrs?.type === 'boolean' && attrs.default === undefined)
    attrs.default = false
  // A description cleared goes back to the placeholder, which the tab shows
  // as empty and the checker reports as still to write.
  const description =
    change.description === undefined
      ? current.description
      : change.description || `${PLACEHOLDER}the ${kind} "${name}".`
  send(declare(kind, name, { attrs, description }))
}

function remove(kind: ContractKind, name: string): void {
  send(undeclare(kind, name))
  if (open.value === `${kind}:${name}`) open.value = null
}

/** The type a new prop gets; a boolean is a state the moment it is visual, so it comes with a default. */
/**
 * What the add row declares: a primitive, a choice, or a model — one of it
 * (`Person`, what an item component shows) or a list of it (`Person[]`, what
 * a list repeats over). A model is offered by name rather than typed, since
 * `Person[]` is syntax a designer should not have to know.
 */
const addType = ref<string>('string')
const modelNames = computed(() => [...(props.models?.keys() ?? [])].sort())
/** A choice prop's values as typed, comma-separated: `primary, secondary`. */
const addOptions = ref('')

/** `primary, secondary` → `'primary' | 'secondary'`; null when fewer than two values. */
function choiceType(text: string): string | null {
  const values = [
    ...new Set(
      text
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  return values.length >= 2
    ? values.map((value) => `'${value.replace(/'/g, '')}'`).join(' | ')
    : null
}

/** A choice prop's options rewritten; its default kept when it is still one of them. */
function setOptions(name: string, text: string, current: unknown): void {
  const type = choiceType(text)
  if (!type) return
  const values = enumValues(type)!
  redeclare('prop', name, {
    attrs: {
      type,
      default: typeof current === 'string' && values.includes(current) ? current : values[0]!,
    },
  })
}

/* ------------------------------------------------------------- states */

/** States a component gets without declaring them: the browser's, and `empty` for a list. */
const builtInStates = computed(() => {
  const contract = view.value.kind === 'component' ? view.value.component.spec?.contract : undefined
  const states = [
    { name: 'hover', label: 'Hover', hint: 'The pointer is over it' },
    { name: 'focus', label: 'Focus', hint: 'It has keyboard focus' },
    { name: 'active', label: 'Pressed', hint: 'It is being pressed' },
  ]
  if (listProps(contract).length)
    states.push({ name: 'empty', label: 'Empty', hint: 'Its list has no items' })
  const rows = props.doc?.spec?.styles ?? []
  return states.map((state) => ({
    ...state,
    on: rows.some((row) => row.keys[STATE_AXIS] === state.name),
  }))
})

/**
 * Turns a built-in state on (an empty row, so the canvas draws it and the
 * author designs it by selecting it) or off (every row naming it goes).
 */
/**
 * The styles table as rows (ADR 0016 §2): each a set of keys and the cells it
 * changes. Designed on the canvas; listed here so a row can be read whole,
 * and a cell or a row taken out, without hunting for the variant that shows it.
 */
const styleRows = computed(() =>
  (props.doc?.spec?.styles ?? []).map((row) => ({
    keys: row.keys,
    label:
      Object.entries(row.keys)
        .map(([axis, value]) => (axis === STATE_AXIS ? value : `${axis}=${value}`))
        .join(' + ') || 'base',
    cells: Object.entries(row.values).flatMap(([target, values]) =>
      Object.entries(values).map(([prop, value]) => ({ target, prop, value })),
    ),
  })),
)
const openRow = ref<string | null>(null)
const rowKey = (keys: Record<string, string>): string => JSON.stringify(Object.entries(keys).sort())
const shown = (value: JsonValue): string =>
  typeof value === 'string' ? value : JSON.stringify(value)

function removeStyleRow(keys: Record<string, string>): void {
  send([{ op: 'style', keys: { ...keys }, target: '', prop: '' }])
}

function removeStyleCell(keys: Record<string, string>, target: string, prop: string): void {
  send([{ op: 'style', keys: { ...keys }, target, prop }])
}

function toggleState(name: string, on: boolean): void {
  if (on) {
    send([{ op: 'style', keys: { [STATE_AXIS]: name }, target: '', prop: '', value: {} }])
    return
  }
  const rows = (props.doc?.spec?.styles ?? []).filter((row) => row.keys[STATE_AXIS] === name)
  send(rows.map((row) => ({ op: 'style', keys: { ...row.keys }, target: '', prop: '' })))
}

/**
 * The contract's single elements (ADR 0013 §2): how assistive technology
 * meets the component, whether it takes part in a form, and what it is built
 * from. Each field writes its whole element; emptying every field removes it.
 */
const ROLES = [
  'button',
  'checkbox',
  'combobox',
  'dialog',
  'img',
  'link',
  'listbox',
  'menu',
  'menuitem',
  'option',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'slider',
  'status',
  'switch',
  'tab',
  'tablist',
  'tabpanel',
  'textbox',
  'tooltip',
]
const accessibility = computed(() => props.doc?.spec?.contract?.accessibility ?? {})
const form = computed(() => props.doc?.spec?.contract?.form)
const composes = computed(() => props.doc?.spec?.contract?.composes ?? [])
const textOf = (value: JsonValue | undefined): string => (typeof value === 'string' ? value : '')

function setAccessibility(key: string, text: string): void {
  const next: Record<string, JsonValue> = { ...accessibility.value }
  if (text.trim()) next[key] = text.trim()
  else delete next[key]
  send([
    Object.keys(next).length
      ? { op: 'contract-element', element: 'Accessibility', attrs: next }
      : { op: 'contract-element', element: 'Accessibility' },
  ])
}

function setForm(change: { participates?: boolean; submits?: string }): void {
  const participates = change.participates ?? form.value?.participates ?? false
  const submits = (change.submits ?? form.value?.submits ?? '').trim()
  if (!participates && !submits) {
    if (form.value) send([{ op: 'contract-element', element: 'Form' }])
    return
  }
  send([
    {
      op: 'contract-element',
      element: 'Form',
      attrs: { participates, ...(submits ? { submits } : {}) },
    },
  ])
}

function setComposes(text: string): void {
  const names = text
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (!names.length) {
    if (composes.value.length) send([{ op: 'contract-element', element: 'Composes' }])
    return
  }
  send([{ op: 'contract-element', element: 'Composes', attrs: { with: names.join(', ') } }])
}

function add(): void {
  const name = addName.value.trim()
  if (!name) return
  const kind = addKind.value
  let attrs: Record<string, JsonValue> = {}
  if (kind === 'prop') {
    if (addType.value === 'choice') {
      const type = choiceType(addOptions.value)
      if (!type) return
      // A choice is an axis of the variant set: visual, its first value the default.
      attrs = { type, default: enumValues(type)![0]!, visual: true }
      addOptions.value = ''
    } else if (addType.value === 'boolean') attrs = { type: 'boolean', default: false }
    else attrs = { type: addType.value }
  }
  send(declare(kind, name, { attrs, description: `${PLACEHOLDER}the ${kind} "${name}".` }))
  addName.value = ''
  open.value = `${kind}:${name}`
}

/**
 * What the element offers, open as a checklist (ADR 0013 §5). Null while
 * closed. Each offer's tick is held by key so the list can be re-read while
 * open without losing what the designer chose.
 */
const offering = ref<LibraryOffer[] | null>(null)
const ticked = ref<Set<string>>(new Set())
const offerKey = (offer: LibraryOffer) => `${offer.kind}:${offer.name}`
/** Grouped by what the library calls them: a prop is offered from one of its attributes. */
const OFFER_GROUPS: { kind: LibraryOffer['kind']; label: string }[] = [
  { kind: 'prop', label: 'Attributes' },
  { kind: 'event', label: 'Events' },
  { kind: 'slot', label: 'Slots' },
  { kind: 'part', label: 'Parts' },
]

function fill(): void {
  if (view.value.kind !== 'component' || !view.value.element) return
  if (offering.value) {
    offering.value = null
    return
  }
  const offers = libraryOffers(view.value.component, view.value.element)
  offering.value = offers
  ticked.value = new Set(offers.filter((offer) => offer.suggested).map(offerKey))
}

function tick(offer: LibraryOffer, on: boolean): void {
  const next = new Set(ticked.value)
  if (on) next.add(offerKey(offer))
  else next.delete(offerKey(offer))
  ticked.value = next
}

function tickAll(on: boolean): void {
  ticked.value = new Set(on ? (offering.value ?? []).map(offerKey) : [])
}

/** What the manifest says about an offer, and its own spelling when the contract's differs. */
const offerTitle = (offer: LibraryOffer): string | undefined =>
  [
    offer.description,
    offer.library && offer.library !== offer.name ? `library name ${offer.library}` : '',
  ]
    .filter(Boolean)
    .join(' — ') || undefined

/** Declare the ticked members, and hand the library spellings they need to the shell. */
function addOffers(): void {
  if (view.value.kind !== 'component' || !offering.value) return
  const chosen = offering.value.filter((offer) => ticked.value.has(offerKey(offer)))
  const made = scaffoldOffers(chosen)
  send(made.patches)
  if (Object.keys(made.attributes).length || Object.keys(made.events).length)
    emit('bindNames', view.value.component.name, {
      attributes: made.attributes,
      events: made.events,
    })
  offering.value = null
}

/** A visual boolean is drawn as a state of the set (ADR 0016 §1); the list says so. */
const isState = (prop: { type: string; visual: boolean }): boolean =>
  prop.visual && prop.type === 'boolean'
</script>

<template>
  <section ref="root" class="contract" aria-label="Contract">
    <!-- Nothing selected: the shell says so itself; a direct mount reads the same. -->
    <InspectorEmpty
      v-if="view.kind === 'page'"
      kind="none"
      v-bind="EMPTY.contract.none"
      :about="ABOUT.contract"
    />

    <template v-else-if="view.kind === 'component'">
      <InspectorSection
        title="Properties"
        label="Properties"
        :meta="contract?.props.length ? String(contract.props.length) : undefined"
        :info="INFO.properties"
      >
        <template #actions>
          <button
            v-if="view.element"
            type="button"
            class="link-button fill"
            :disabled="!writable"
            title="Declare what the element exposes and the contract lacks"
            :aria-expanded="offering !== null"
            @click="fill"
          >
            Fill from library
          </button>
        </template>
        <section v-if="offering?.length" class="offers" aria-label="What the library offers">
          <p class="offers-bar">
            {{ ticked.size }} of {{ offering.length }} selected ·
            <button type="button" class="link-button" @click="tickAll(true)">All</button>
            ·
            <button type="button" class="link-button" @click="tickAll(false)">None</button>
          </p>
          <template v-for="group in OFFER_GROUPS" :key="group.kind">
            <template v-if="offering.some((offer) => offer.kind === group.kind)">
              <p class="offers-heading">{{ group.label }}</p>
              <label
                v-for="offer in offering.filter((entry) => entry.kind === group.kind)"
                :key="offerKey(offer)"
                class="offer"
                :title="offerTitle(offer)"
              >
                <input
                  type="checkbox"
                  :checked="ticked.has(offerKey(offer))"
                  @change="tick(offer, ($event.target as HTMLInputElement).checked)"
                />
                <span class="offer-name">{{ offer.name }}</span>
                <span v-if="offer.type" class="offer-type" :title="offer.type">{{
                  offer.type
                }}</span>
              </label>
            </template>
          </template>
          <div class="offers-actions">
            <button type="button" class="btn" @click="offering = null">Cancel</button>
            <button
              type="button"
              class="btn primary"
              :disabled="!writable || ticked.size === 0"
              @click="addOffers"
            >
              {{ ticked.size ? `Add ${ticked.size}` : 'Add' }}
            </button>
          </div>
        </section>
        <!-- Nothing left to offer is one faint line, not an empty well with a lone button. -->
        <p v-else-if="offering" class="hint" data-field="offers-none">
          Nothing new in {{ view.element?.tag }} ·
          <button type="button" class="link-button" @click="offering = null">Close</button>
        </p>
        <p v-if="!declCount && offering === null" class="hint">
          No properties yet. Add one below{{ view.element ? ', or fill from the library' : '' }}.
        </p>

        <!-- Props -->
        <template v-for="prop in contract?.props ?? []" :key="`prop:${prop.name}`">
          <div
            class="row read"
            :data-prop="prop.name"
            :data-draft="isPlaceholder(prop.description)"
          >
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
              <span>Name</span>
              <input
                class="text"
                :value="prop.name"
                :disabled="!writable || !file"
                aria-label="Prop name"
                title="Renaming carries its bindings, style rows, examples and every instance that sets it"
                @change="renameProp(prop.name, ($event.target as HTMLInputElement).value)"
              />
            </label>
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
                list="contract-types"
                :disabled="!writable"
                @change="
                  redeclare('prop', prop.name, {
                    attrs: { type: ($event.target as HTMLInputElement).value.trim() },
                  })
                "
              />
            </label>
            <label v-if="enumValues(prop.type)" class="field">
              <span>Choices</span>
              <input
                class="text"
                :value="enumValues(prop.type)!.join(', ')"
                aria-label="Choices, separated by commas"
                :disabled="!writable"
                title="Each choice is a column or row of the variant set"
                @change="
                  setOptions(prop.name, ($event.target as HTMLInputElement).value, prop.default)
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

        <!-- Events: the subhead says what they are, so the rows carry only the name. -->
        <header v-if="contract?.events.length" class="subhead">
          <span class="title">Events</span>
          <span class="of">{{ contract.events.length }}</span>
        </header>
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
              <span class="name-text">{{ event.name }}</span>
              <span v-if="isPlaceholder(event.description)" class="flag" title="Needs a description"
                >?</span
              >
            </button>
            <span class="type" :title="event.detail">{{ event.detail ?? '' }}</span>
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
                    attrs: {
                      detail: ($event.target as HTMLInputElement).value.trim() || undefined,
                    },
                  })
                "
              />
            </label>
          </div>
        </template>

        <!-- Declared slots; the Slots section below says which the tree draws. -->
        <header v-if="contract?.slots.length" class="subhead">
          <span class="title">Slots</span>
          <span class="of">{{ contract.slots.length }}</span>
        </header>
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
              <span class="name-text">{{ slot.name }}</span>
              <span v-if="isPlaceholder(slot.description)" class="flag" title="Needs a description"
                >?</span
              >
            </button>
            <span class="type" :title="slot.accepts ? `accepts ${slot.accepts}` : undefined">{{
              slot.accepts ? `accepts ${slot.accepts}` : ''
            }}</span>
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
        </template>

        <!-- Element states and described parts, each under its own subhead. -->
        <header v-if="contract?.states.length" class="subhead">
          <span class="title">Element states</span>
          <span class="of">{{ contract.states.length }}</span>
        </header>
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
              <span
                class="pill"
                title="A state the element produces itself, styled through :state()"
                >element</span
              >
            </button>
            <span class="type" />
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
        <header v-if="contract?.parts.length" class="subhead">
          <span class="title">Parts</span>
          <span class="of">{{ contract.parts.length }}</span>
        </header>
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
              :title="`${part.name} · ${part.description}`"
              @click="toggle(`part:${part.name}`)"
            >
              <span class="name-text">{{ part.name }}</span>
              <span v-if="isPlaceholder(part.description)" class="flag" title="Needs a description"
                >?</span
              >
            </button>
            <span class="type" />
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

        <!-- Add a declaration: the name on its own line, then what kind and type it is. -->
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
          <datalist id="contract-types">
            <option value="string" />
            <option value="number" />
            <option value="boolean" />
            <template v-for="model in modelNames" :key="model">
              <option :value="model" />
              <option :value="`${model}[]`" />
            </template>
          </datalist>
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
            <option value="choice">choice</option>
            <optgroup v-if="modelNames.length" label="Models">
              <template v-for="model in modelNames" :key="model">
                <option :value="model">{{ model }}</option>
                <option :value="`${model}[]`">list of {{ model }}</option>
              </template>
            </optgroup>
          </select>
          <input
            v-if="addKind === 'prop' && addType === 'choice'"
            v-model="addOptions"
            class="text options"
            :disabled="!writable"
            aria-label="Choices, separated by commas"
            placeholder="primary, secondary"
            title="Two or more values, separated by commas. Each becomes a column or row of the variant set."
            @keydown.enter="add"
          />
          <button
            type="button"
            class="reset"
            :disabled="
              !writable ||
              !addName.trim() ||
              (addKind === 'prop' && addType === 'choice' && !choiceType(addOptions))
            "
            aria-label="Add declaration"
            title="Declare it; describe it after"
            @click="add"
          >
            +
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="States" :info="INFO.states">
        <div class="state-toggles" data-tour="states">
          <label
            v-for="state in builtInStates"
            :key="state.name"
            class="state-toggle"
            :title="state.hint"
            :data-state="state.name"
          >
            <input
              type="checkbox"
              :checked="state.on"
              :disabled="!writable"
              @change="toggleState(state.name, ($event.target as HTMLInputElement).checked)"
            />
            {{ state.label }}
          </label>
        </div>
      </InspectorSection>

      <InspectorSection
        v-if="styleRows.length"
        title="Styles"
        :meta="String(styleRows.length)"
        :info="INFO.styles"
      >
        <template v-for="row in styleRows" :key="rowKey(row.keys)">
          <div class="row read" :data-style-row="row.label">
            <button
              type="button"
              class="name open"
              :aria-expanded="openRow === rowKey(row.keys)"
              @click="openRow = openRow === rowKey(row.keys) ? null : rowKey(row.keys)"
            >
              <span class="name-text" :title="row.label">{{ row.label }}</span>
            </button>
            <span class="type">
              {{
                row.cells.length
                  ? `${row.cells.length} change${row.cells.length === 1 ? '' : 's'}`
                  : 'no changes yet'
              }}
            </span>
            <button
              type="button"
              class="reset"
              :disabled="!writable"
              :aria-label="`Remove style row ${row.label}`"
              title="Remove this row and every change in it"
              @click="removeStyleRow(row.keys)"
            >
              ×
            </button>
          </div>
          <div v-if="openRow === rowKey(row.keys)" class="form">
            <div
              v-for="cell in row.cells"
              :key="`${cell.target}:${cell.prop}`"
              class="cell"
              :data-cell="`${cell.target}:${cell.prop}`"
            >
              <code>{{ cell.target }}:{{ cell.prop }}</code>
              <span class="cell-value" :title="shown(cell.value)">{{ shown(cell.value) }}</span>
              <button
                type="button"
                class="reset"
                :disabled="!writable"
                :aria-label="`Remove ${cell.target}:${cell.prop} from ${row.label}`"
                @click="removeStyleCell(row.keys, cell.target, cell.prop)"
              >
                ×
              </button>
            </div>
            <p v-if="!row.cells.length" class="hint">
              Select this state on the canvas and change something to give it a look.
            </p>
          </div>
        </template>
      </InspectorSection>

      <InspectorSection
        v-if="view.slots.length || view.straySlots.length"
        title="Slots"
        :meta="slotsMeta"
        :info="INFO.slots"
      >
        <div
          v-for="stray in view.straySlots"
          :key="`stray:${stray.address}`"
          class="row pick-row"
          :data-stray-slot="stray.name"
          data-bound="false"
        >
          <!--
            A fault, not a binding: a status like "Not drawn" on the shared
            grid, never the purple layer chip, and declared from the + where
            every other row keeps its action.
          -->
          <span class="name">
            <span class="tone-dot" data-tone="warn" />
            <span class="name-text" :title="stray.name">{{ stray.name }}</span>
          </span>
          <span class="status">Not declared</span>
          <button
            type="button"
            class="reset"
            :disabled="!writable"
            :aria-label="`Declare slot ${stray.name}`"
            :title="`Declare slot ${stray.name} in the contract`"
            @click="declareSlot(stray.name)"
          >
            +
          </button>
        </div>
        <div
          v-for="slot in view.slots"
          :key="slot.name"
          class="row pick-row"
          :data-slot="slot.name"
          :data-bound="slot.provided !== null"
        >
          <span class="name">
            <span class="name-text" :title="slot.name">{{ slot.name }}</span>
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
            :title="
              slot.provided.repeat ? 'Select the slot, filled once per item' : 'Select the slot'
            "
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
              {{ slot.provided.repeat ? 'Per item' : 'Slot in tree' }}
            </span>
          </button>
          <span v-else class="status">{{ COPY.notDrawn }}</span>
          <span class="reset-spacer" />
        </div>
      </InspectorSection>

      <InspectorSection
        collapsible
        field="accessibility"
        title="Accessibility and forms"
        :open="Object.keys(accessibility).length > 0 || !!form || composes.length > 0"
      >
        <label class="field">
          <span>Role</span>
          <input
            class="text"
            list="contract-roles"
            :value="textOf(accessibility.role)"
            :disabled="!writable"
            aria-label="Role"
            placeholder="button"
            title="What assistive technology announces it as"
            @change="setAccessibility('role', ($event.target as HTMLInputElement).value)"
          />
          <datalist id="contract-roles">
            <option v-for="role in ROLES" :key="role" :value="role" />
          </datalist>
        </label>
        <label class="field">
          <span>Keyboard</span>
          <input
            class="text"
            :value="textOf(accessibility.keyboard)"
            :disabled="!writable"
            aria-label="Keyboard"
            placeholder="Enter and Space activate"
            @change="setAccessibility('keyboard', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="field">
          <span>Accessible name</span>
          <input
            class="text"
            :value="textOf(accessibility.label)"
            :disabled="!writable"
            aria-label="Accessible name"
            placeholder="from {label}"
            @change="setAccessibility('label', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label class="check">
          <input
            type="checkbox"
            :checked="form?.participates ?? false"
            :disabled="!writable"
            aria-label="Takes part in forms"
            @change="setForm({ participates: ($event.target as HTMLInputElement).checked })"
          />
          Takes part in forms
        </label>
        <label v-if="form?.participates" class="field">
          <span>Submits</span>
          <input
            class="text"
            :value="form?.submits ?? ''"
            :disabled="!writable"
            aria-label="Submits"
            placeholder="value while checked, nothing otherwise"
            @change="setForm({ submits: ($event.target as HTMLInputElement).value })"
          />
        </label>
        <label class="field">
          <span>Composes</span>
          <input
            class="text"
            :value="composes.join(', ')"
            :disabled="!writable"
            aria-label="Composes"
            placeholder="Field, Icon"
            title="Components this one is built from, separated by commas"
            @change="setComposes(($event.target as HTMLInputElement).value)"
          />
        </label>
      </InspectorSection>

      <!--
        How the component reaches code. A designer never needs this; a
        developer binding the render to a headless element opens it. Closed by
        default so the tab leads with what instances can change.
      -->
      <InspectorSection
        ref="bindingSection"
        collapsible
        field="code-binding"
        title="Code binding"
        :open="bindingOpen || view.implementsValue !== null"
        :meta="view.implementsValue ?? 'for developers'"
        :info="INFO.codeBinding"
      >
        <div class="row stacked" data-field="implements" :data-set="view.implementsValue !== null">
          <span class="name">Headless element</span>
          <span class="type">{{ view.implementsValue ?? 'Not connected' }}</span>
          <button type="button" class="link-button" @click="emit('act', ACTION.setupComponent)">
            Change in Setup
          </button>
        </div>
        <p v-if="!library && !paused" class="hint" data-field="choose-library">
          {{ COPY.connectLibrary }}
          <button type="button" class="link-button" @click="emit('act', ACTION.openConnect)">
            {{ ACTION.openConnect.label }}
          </button>
        </p>
        <p v-if="boundTag && boundTag !== view.implementsValue" class="hint" data-field="bound">
          Library tag <code class="path-chip" :title="boundTag">{{ boundTag }}</code> · set in
          uidx.json
        </p>
        <p v-if="members" class="hint" :title="members.title">{{ members.text }}</p>

        <header class="subhead">
          <span class="title">Parts</span>
          <span v-if="view.parts.length" class="of">{{
            COPY.partsBound(boundCount, view.parts.length)
          }}</span>
          <button
            v-if="byName.length"
            type="button"
            class="link-button bind-by-name"
            :disabled="!writable"
            title="Bind each unbound part to the layer that has its name"
            @click="send(byName)"
          >
            Bind by name
          </button>
        </header>
        <p v-if="paused" class="hint">{{ COPY.partsPaused }}</p>
        <template v-else-if="!view.parts.length">
          <p v-if="view.implementsValue === null" class="hint">{{ COPY.chooseElement }}</p>
          <!-- The missing library is said once, above; without one, parts are the contract's. -->
          <p v-else-if="!library" class="hint">{{ COPY.contractNoParts }}</p>
          <div v-else-if="!view.element" class="issue" role="status">
            <span class="tone-dot" data-tone="warn" />
            <span>{{ COPY.tagMissing(view.implementsValue) }}</span>
          </div>
          <p v-else class="hint">{{ COPY.noParts(view.implementsValue) }}</p>
        </template>
        <!--
          Bound from the component's side (Figma declares a property here) — each
          declared part is a row, and an unbound row is a picker over the layers
          that could draw it. A bound row names its layer and jumps to it.
        -->
        <div
          v-for="row in view.parts"
          :key="row.name"
          class="row pick-row"
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
                  : 'declared by the contract; the library does not know it') +
              (row.kind === 'shadow' ? ' · a shadow part, drawn by the library' : '')
            "
          >
            <span class="name-text">{{ row.name }}</span>
            <span
              v-if="row.declaredBy === 'contract' && view.element"
              class="flag"
              title="Not in the library"
              >?</span
            >
            <span
              v-if="row.kind === 'shadow' && !allShadow"
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
            :title="
              view.candidates.length
                ? `Bind a layer to draw ${row.name}`
                : 'No unbound layer is left to draw it'
            "
            @change="bind(row.name, ($event.target as HTMLSelectElement).value)"
          >
            <!-- Short enough for the narrowest pane: a native select cannot ellipsise. -->
            <option value="" disabled>
              {{ view.candidates.length ? 'Bind…' : 'None left' }}
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
        <template v-if="!paused">
          <div v-for="stray in view.strayParts" :key="stray.address" class="issue" role="status">
            <span class="tone-dot" :data-tone="view.element ? 'warn' : 'info'" />
            <span>{{ COPY.strayPart(stray.name, stray.part) }}</span>
            <button type="button" class="link-button" @click="emit('select', stray.address)">
              Show
            </button>
          </div>
        </template>
      </InspectorSection>
    </template>

    <InspectorSection
      v-else-if="view.kind === 'part'"
      title="Part"
      :meta="`of ${view.component.name}`"
    >
      <template #actions>
        <button
          type="button"
          class="link-button"
          :title="`Select ${view.component.name}`"
          :aria-label="`Select ${view.component.name}`"
          @click="emit('select', view.component.address)"
        >
          Select component
        </button>
      </template>
      <p v-if="view.undeclared" class="hint">{{ COPY.noImplements(view.component.name) }}</p>
      <!--
        Bound from the layer's side (Figma applies a property here). Parts held
        by another layer stay listed and say who has them: a part is bound once,
        and seeing where it went beats a list that silently shrinks.
      -->
      <template v-else>
        <div class="row stacked" data-field="part" :data-set="view.partValue !== null">
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
        <div v-if="badPart" class="issue" role="status">
          <span class="tone-dot" data-tone="warn" />
          <span>{{ COPY.notAPart(partTag) }}</span>
        </div>
      </template>
    </InspectorSection>

    <template v-else-if="view.kind === 'slot'">
      <!-- The same panel the Design tab shows: one place that sets a slot up. -->
      <div v-if="view.component" class="bleed slot-wrap">
        <SlotSettingsSection
          :doc="doc"
          :node="view.node"
          :components="components"
          :models="models"
          :pages="pages"
          :library="library"
          :writable="writable"
          @patches="emit('patches', $event)"
          @open-model="emit('openModel', $event)"
          @select="emit('select', $event)"
        />
      </div>
      <InspectorEmpty
        v-else-if="fillEmpty"
        kind="slot-fill"
        v-bind="fillEmpty"
        @act="emit('act', $event)"
      />
      <InspectorEmpty
        v-else
        kind="slot-outside"
        v-bind="SLOT_OUTSIDE"
        :action="makeComponent"
        @act="emit('act', $event)"
      />
    </template>

    <InspectorSection
      v-else-if="view.kind === 'derived'"
      title="State"
      :meta="view.state"
      :meta-title="view.state"
    >
      <p class="hint">
        Bindings live on the base layer.
        <button type="button" class="link-button" @click="emit('select', view.base.address)">
          Select {{ view.base.name }}
        </button>
      </p>
    </InspectorSection>

    <template v-else-if="view.kind === 'instance'">
      <div v-if="!view.definition" class="issue missing" role="status">
        <span class="tone-dot" data-tone="warn" />
        <span>This document has no component called “{{ view.node.attrs.component?.value }}”.</span>
      </div>
      <InspectorEmpty
        v-else-if="!view.component"
        kind="instance"
        v-bind="instanceEmpty('contract', view.definition.name)"
        @act="emit('act', $event)"
      />
      <!--
        Inside a repeat, the row's item is what the instance is of (ADR 0017
        §2): a prop typed by the item's model receives the item without a
        word written, as the code target passes it. The rows say what each
        prop receives, mark what was inferred, and let the use say otherwise.
      -->
      <InspectorSection v-else title="Data connections" :meta="view.definition.name">
        <p class="hint">Choose the values and model fields this instance receives in Data.</p>
        <button type="button" class="link-button" @click="emit('act', ACTION.openData)">
          Open Data
        </button>
      </InspectorSection>
    </template>

    <InspectorEmpty
      v-else
      kind="outside"
      v-bind="EMPTY.contract.outside"
      :action="makeComponent"
      @act="emit('act', $event)"
    />
  </section>
</template>

<style scoped>
/*
 * The tab body adds no gutter of its own: sections bleed to the pane's edges
 * through InspectorSection, and everything else sits on the pane's 16px.
 */
.contract {
  min-width: 0;
  padding: 0 0 12px;
}
.of {
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
/* A group inside a section (Parts in Code binding): a quieter head, never a second rule. */
.subhead {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  margin-top: 8px;
}
.subhead .title {
  flex: none;
  color: var(--text-dim);
  font-weight: 600;
}
.subhead .of {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.subhead .link-button {
  flex: none;
  margin-left: auto;
  font-size: var(--ui-size-sm);
  font-weight: 500;
  white-space: nowrap;
}
.row {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr) 24px;
  align-items: center;
  gap: var(--gap);
  min-width: 0;
  min-height: var(--field-h);
  padding: 4px 0;
}
/* A row whose second cell is a control gives it the room, as Design's instance rows do. */
.row.pick-row {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) 24px;
}
/*
 * Rows that open an editor: a tint under the pointer that stays on the open
 * row. Neutral, never --bound; the margin and padding cancel, so the columns
 * stay on the grid and the tint reaches 6px into the gutter.
 */
.row.read {
  min-height: var(--row-h);
  margin: 0 -6px;
  padding: 2px 6px;
  border-radius: var(--radius-lg);
}
.row.read:has(> .name.open:hover),
.row.read:has(> .name.open[aria-expanded='true']) {
  background: color-mix(in srgb, var(--raised) 50%, transparent);
}
/* A row with no type to show (an element state, a described part) gives its name the room. */
.row.read > .type:empty {
  display: none;
}
.row.read:has(> .type:empty) > .name {
  grid-column: 1 / 3;
}
.name {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  min-width: 0;
  overflow: hidden;
  color: var(--text-dim);
  white-space: nowrap;
}
.name > .pill,
.name > .flag,
.name > .tone-dot {
  flex: none;
}
.row[data-set='true'] .name,
.row[data-bound='true'] .name {
  color: var(--text);
}
/* A caption over a full-width control: Headless element, Draws. */
.row.stacked {
  grid-template-columns: minmax(0, 1fr) 24px;
  row-gap: 4px;
}
.row.stacked > .name {
  grid-column: 1 / -1;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
.row.stacked[data-field='implements'] {
  grid-template-columns: minmax(0, 1fr) auto;
}
.name-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/*
 * A part name breaks at its hyphens rather than ellipsing to the same prefix
 * as its siblings ('form-control-label', 'form-control-input'…).
 */
.row.pick-row[data-part] .name {
  white-space: normal;
}
.row.pick-row[data-part] .name-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-height: 16px;
  white-space: normal;
  overflow-wrap: anywhere;
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
.text:hover:not(:disabled),
.pick:hover:not(:disabled) {
  border-color: var(--line);
}
.pick {
  width: 100%;
  cursor: pointer;
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
.layer:hover:not(:disabled) {
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
  min-width: 0;
  overflow: hidden;
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill {
  flex: none;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--raised);
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  font-weight: 500;
  line-height: 16px;
}
/* Needs a description: a hollow dot beside the name, not a coloured name. */
.flag {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1.5px var(--text-faint);
  font-size: 0;
}
/* A part the library does not declare: the warn dot every problem mark uses. */
.row[data-part] .flag {
  background: var(--warn);
  box-shadow: none;
}
.reset {
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
.reset:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.reset-spacer {
  width: 24px;
}
.hint {
  margin: 0 0 6px;
  padding-top: 0;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  line-height: 16px;
}
.row + .hint,
.row + .issue {
  margin-top: 2px;
}
code {
  font-family: var(--mono-font);
  font-size: 11px;
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
  gap: 4px;
  min-width: 0;
}
.field > span {
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
[data-field='accessibility'] .field,
[data-field='accessibility'] .check {
  margin: 0 0 8px;
}
[data-field='accessibility'] .check {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: var(--row-h);
  color: var(--text);
}
.pair {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
.flags {
  display: flex;
  gap: 12px;
  color: var(--text-dim);
}
.flags label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/*
 * The add row: the name on a line of its own, then what kind and type it is
 * and the +, then a choice's values. Three equal columns at any width, so
 * nothing in it is squeezed below a readable select.
 */
.row.add,
.row.add.typed {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 24px;
  row-gap: 4px;
  margin-top: 4px;
}
.row.add > input.text:not(.options) {
  grid-row: 1;
  grid-column: 1 / -1;
}
.row.add > select[aria-label='Kind to add'] {
  grid-row: 2;
  grid-column: 1;
}
.row.add:not(.typed) > select[aria-label='Kind to add'] {
  grid-column: 1 / 3;
}
.row.add > .pick.narrow {
  grid-row: 2;
  grid-column: 2;
}
.row.add > .reset {
  grid-row: 2;
  grid-column: 3;
}
.row.add .options {
  grid-row: 3;
  grid-column: 1 / -1;
}
.cell {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 24px;
  gap: 8px;
  align-items: center;
  font-size: 11px;
}
.cell code {
  color: var(--text-dim);
}
.cell-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.state-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
}
.state-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--row-h);
  font-size: var(--ui-size);
  color: var(--text);
  cursor: pointer;
}
/* Fill from library: a checklist in a well, its count and buttons pinned while it scrolls. */
.offers {
  margin: 0 0 10px;
  padding: 0 8px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--bg);
  max-height: 320px;
  overflow-y: auto;
}
.offers-bar {
  position: sticky;
  top: 0;
  z-index: 1;
  margin: 0;
  padding: 8px 0 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--line);
  color: var(--text-faint);
  font-size: var(--ui-size-sm);
}
.offers-heading {
  margin: 8px 0 2px;
  color: var(--text-dim);
  font-size: 11px;
  font-weight: 600;
}
.offer {
  display: grid;
  grid-template-columns: 14px minmax(0, 1.4fr) minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-height: 24px;
  cursor: pointer;
}
.offer-name {
  overflow: hidden;
  font-family: var(--mono-font);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.offer-name:last-child {
  grid-column: 2 / -1;
}
.offer-type {
  overflow: hidden;
  color: var(--text-faint);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.offers-actions {
  position: sticky;
  bottom: 0;
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin: 8px 0 0;
  padding: 8px 0;
  background: var(--bg);
  border-top: 1px solid var(--line);
}
/* An instance of a component the document lacks: the one line the view has. */
.issue.missing {
  padding: 12px 0;
}
/*
 * Repeat and the slot panel are shared with the Design tab and keep their
 * own heads; here they get the tab's full-bleed rule below them, and the
 * slot panel's own rule goes so there is one line, not two.
 */
.bleed {
  min-width: 0;
  margin: 0 calc(-1 * var(--section-pad));
  padding: 0 var(--section-pad);
  border-bottom: 1px solid var(--line);
}
.bleed:empty {
  display: none;
}
/* Each shared head centred where a 44px section head would be. */
.repeat-wrap {
  padding: 10px var(--section-pad) 12px;
}
.slot-wrap {
  padding-top: 2px;
}
.bleed :deep(.slot-settings) {
  margin-bottom: 0;
  border-bottom: 0;
}
/* Shown on request from the shell: clear the sticky inspector header above it. */
[data-field='code-binding'] {
  scroll-margin-top: 96px;
}
</style>
