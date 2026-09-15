<script setup lang="ts">
import './inspector-controls.css'
import { provide } from 'vue'
import {
  LENGTH_PROPS,
  rootFontSizeOf,
  lengthToPx,
  preserveLengthUnit,
  hasLengthUnits,
  isUnitLength,
} from '@uidx/format'
import { LENGTH_FIELD_CONTEXT } from './length-field-context'

import { computed, ref, shallowRef, watch } from 'vue'
import { vectorEndpoints } from '@open-pencil/core/vector'
import {
  PropertySectionContent,
  PropertySectionHeader,
  PropertySectionRoot,
  PropertySectionTitle,
} from '@open-pencil/vue'
import {
  aliasTarget,
  componentProps,
  METADATA_ATTRS,
  resolve,
  type JsonValue,
  type PropertyType,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'
import {
  isPinnedAxis,
  propUiFor,
  PIN_PROPS,
  pinFrom,
  resolvedBox,
  SECTION_ORDER,
  scenePropFor,
  isStrokeEndpointProp,
  type PinAxis,
  type PropGroup,
  type TokenIndex,
} from '@uidx/schema'
import { pinWrites, type PinFrame, type PinWrites } from './pin-writes'
import {
  convertibleToSlot,
  convertToSlotFor,
  deleteSlotContentsFor,
  resetSlotFor,
} from './slot-edits'

import {
  editableProps,
  parentOf,
  sectionsFor,
  selectedNode,
  type EditableProp,
  type PropSection,
} from './editable'
import PropertyField from './PropertyField.vue'
import InspectorGroup from './InspectorGroup.vue'
import { inspectorGroups } from './inspector-layout'
import GraphicsSection from './GraphicsSection.vue'
import type { VectorAction, VectorEditInfo } from './vertex-edit'
import {
  addEffect,
  addSolidPaint,
  asEffects,
  asPaints,
  documentSwatches,
  paintColorAlias,
} from './paint-edit'
import AlignmentMatrix from './AlignmentMatrix.vue'
import PaddingField from './PaddingField.vue'
import DimensionsField from './DimensionsField.vue'
import CornerField from './CornerField.vue'
import type { TokenBindingSource, TokenDetachWrite } from './token-binding-source'
import ComponentPropsSection from './ComponentPropsSection.vue'
import {
  bindCandidates,
  bindProperty,
  declareAndBindProperty,
  defaultFor,
  editProperty,
  enclosingComponent,
  propertyTypeForField,
  unbindProperty,
} from './component-prop-edits'
import {
  clampScale,
  EXPORT_FORMATS,
  fileNameFor,
  pixelSizeFor,
  type ExportBounds,
  type ExportFormat,
  type ExportRequest,
} from './export-image'
import ModeRow from './ModeRow.vue'
import PropertyDialog from './PropertyDialog.vue'
import PropertyLink from './PropertyLink.vue'
import ComponentVariantsSection from './ComponentVariantsSection.vue'
import InstancePropsSection from './InstancePropsSection.vue'
import { FieldIcon } from './field-icons'
import type { SideValues } from './edit-models'
import {
  bindVariable,
  clearNodeMode,
  detachVariable,
  setNodeMode,
  variableCandidates,
  variableTypeForControl,
} from './variable-binding'
import type { VariableCandidate } from './variable-binding'

const props = defineProps<{
  doc: UidxDocument | null
  selection?: string[]
  /** Token address -> literal, so a bound row can show what it resolves to. */
  tokens?: Map<string, JsonValue>
  /**
   * What the token documents declare (G8).
   *
   * Separate from `tokens` because a scope is a fact about the *variable*, not
   * about the value it resolved to — the flat map has no room for one.
   */
  tokenIndex?: TokenIndex
  /** False while the socket is down; every control goes read-only. */
  writable?: boolean
  /**
   * Every `<Component>` in the document, by global name (F7).
   *
   * An instance's property list comes from its *definition*, which may be on
   * another page — so the panel needs the document-wide index for the same
   * reason the canvas and the rail do.
   */
  components?: ReadonlyMap<string, UidxNode>
  /**
   * Every page, and the name of the one that is open (F9).
   *
   * Renaming a variant's coordinate has to carry the `props` of every instance
   * that names it, and those sit on the consuming pages rather than on this
   * one — so the section needs both the pages to search and the file its own
   * edits are addressed to.
   */
  pages?: ReadonlyMap<string, UidxDocument>
  file?: string
  /**
   * The selected node's visual extent, as the canvas measures it.
   *
   * The panel cannot compute this: a node's authored `width` and `height` are
   * the box it declares, and an export writes the box it *occupies* — a
   * shadow, an outside stroke and every descendant push past the declaration.
   * `computeContentBounds` is the only answer, and it needs the scene graph.
   * Null until the canvas has measured, which is also what "nothing to
   * export" looks like.
   */
  exportBounds?: ExportBounds | null
  /**
   * Where the selected node sits, and inside what (H2, ADR 0011).
   *
   * The panel cannot work either out: a pinned node's `x` is the resolve
   * pass's answer and appears in no attribute, and the parent's size is
   * whatever layout settled on. Measured by the canvas, like `exportBounds`,
   * and null until it has — which is also what "nothing is selected" looks
   * like.
   */
  pinFrame?: PinFrame | null
  vectorInfo?: VectorEditInfo | null
  canMakeComponent?: boolean
}>()

/**
 * Two events, because story C4 turns on the difference.
 *
 * `preview` is a value passing through — a scrub in progress. It updates the
 * canvas and touches nothing else. `commit` is the author saying they meant
 * it, and is what becomes a patch and a line in the diff — except a
 * fills/strokes write that carries or replaces a paint alias, which reaches
 * the file through `patches` instead (`onCommit`'s alias branch below), since
 * the scene graph would resolve the alias away before a patch could be
 * derived from it. A five-second drag is hundreds of the first and exactly
 * one of the second.
 */
const emit = defineEmits<{
  preview: [address: string, prop: string, value: JsonValue]
  commit: [address: string, prop: string, value: JsonValue]
  /**
   * Which prop's control the cursor is resting on, so the canvas can light the
   * thing it governs. Null on leave. What (if anything) lights up is
   * `hover-map.ts`'s decision, not the panel's.
   */
  hover: [address: string, prop: string | null]
  /**
   * A structural edit, straight at the document (story F6).
   *
   * `commit` above routes through the scene graph, which is right for a scene
   * property and impossible for a component's *declarations*: `props` is in
   * `STRUCTURAL_PROPS`, so `scenePropFor` stops it and no scene node ever
   * carries it. This is the layers rail's route, in the other pane.
   */
  patches: [patches: UidxPatch[]]
  /**
   * One edit that lands in several files (story F9).
   *
   * Renaming a variant's coordinate moves the declaration on this page and the
   * `props` of every instance that names it, wherever those sit. A patch
   * envelope is page-addressed, so this is a map rather than a list, and the
   * shell sends one envelope per page.
   */
  remap: [byFile: ReadonlyMap<string, UidxPatch[]>]
  /** Why an edit was refused, in words meant for the author. */
  refused: [reason: string]
  /**
   * Render this node and hand the author the file.
   *
   * Not `commit`, and not `patches`: an export writes nothing to the document.
   * It leaves the panel because only the canvas holds a scene graph and a Skia
   * renderer, and travels as one object because the file name is the panel's
   * answer — the button said it out loud, and the file that arrives has to be
   * the one it named.
   */
  export: [request: ExportRequest]
  editVector: [address: string]
  finishVector: []
  vectorAction: [action: VectorAction]
  makeComponent: []
}>()

function onHover(prop: string | null): void {
  const address = active.value?.address
  if (address) emit('hover', address, prop)
}

/** Figma's "on this page" row: computed once for every picker in the panel. */
const swatches = computed(() => (props.doc ? documentSwatches(props.doc.tree) : []))

/** The `<Component>` an instance names, from the document-wide index (F7). */
function definitionFor(node: UidxNode): UidxNode | undefined {
  const named = node.attrs.component?.value
  return typeof named === 'string' ? props.components?.get(named) : undefined
}

const active = computed(() => selectedNode(props.doc?.tree ?? null, props.selection ?? []))
const rootFontSize = computed(() => rootFontSizeOf(props.doc))
provide(LENGTH_FIELD_CONTEXT, {
  rootFontSize,
  valueFor: (prop) => {
    const attrs = active.value?.attrs
    return (
      attrs?.[prop]?.value ?? (prop.endsWith('Radius') ? attrs?.cornerRadius?.value : undefined)
    )
  },
})
function changeRootSize(event: Event): void {
  if (!props.doc || props.writable === false) return
  const value = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(value) || value <= 0 || value === rootFontSize.value) return
  emit('patches', [
    {
      op: props.doc.tree.attrs.rootFontSize ? 'set' : 'add',
      address: '',
      prop: 'rootFontSize',
      value,
    },
  ])
}
const parent = computed(() =>
  active.value && props.doc ? parentOf(props.doc.tree, active.value.address) : null,
)
/** The pin the selected node states, or undefined when it states none. */
const pin = computed(() =>
  active.value
    ? pinFrom(active.value.attrs, rootFontSize.value, (address) => props.tokens?.get(address))
    : undefined,
)

/**
 * X, Y, W and H read the *resolved* box on a pinned axis.
 *
 * The file states no coordinate there, so C7's unset row would otherwise show
 * the engine default and call it a position — live on 2026-08-29 that read 0
 * on a node sitting at 524. Figma keeps X editable on a pinned child and
 * rewrites the offset behind it, which is the friendlier behaviour and the one
 * the spec chose: the number on screen is where the node *is*, and typing a
 * new one moves it there by the only route the file has.
 *
 * The size rows need it for the same reason one section down: under STRETCH
 * the width is the resolver's answer and the file states none, so the row
 * would otherwise show the engine's default and call it a size.
 */
/**
 * The frame the rows derive from, before the canvas has measured one.
 *
 * The measure arrives only after the canvas's first settled render or preview
 * frame, and a row whose value only the measure supplies — a stretched size,
 * a MAX offset's live position — showed a dash until the first gesture
 * (review, 2026-08-30). The document can answer at first paint whenever the
 * parent's size is authored: the same `resolvedBox` the build runs. The
 * measure replaces it the moment it exists, since only the graph knows a
 * hugged or stretched ancestor's true size.
 */
const docPinFrame = computed<PinFrame | null>(() => {
  if (!active.value || !parent.value) return null
  const num = (name: string): number | null => {
    const value = parent.value?.attrs[name]?.value
    return lengthToPx(value, rootFontSize.value)
  }
  const width = num('width')
  const height = num('height')
  if (width === null || height === null) return null
  const attr = (name: string): number => {
    const value = active.value?.attrs[name]?.value
    return lengthToPx(value, rootFontSize.value) ?? 0
  }
  const box = { x: attr('x'), y: attr('y'), width: attr('width'), height: attr('height') }
  const size = { width, height }
  return { box: pin.value ? resolvedBox(pin.value, box, size) : box, parent: size }
})

const fields = computed<EditableProp[]>(() => {
  if (!active.value) return []
  const built = editableProps(active.value, parent.value)
  const frame = props.pinFrame ?? docPinFrame.value
  if (!frame) return built
  /*
   * Every position and size row derives from the measured box, not the file.
   *
   * At rest the two agree — the resolve pass put the box exactly where the
   * offsets say, so converting it back round-trips to the authored numbers.
   * Mid-gesture they differ, and the box is the one the author is looking at:
   * the canvas bumps `previewRevision` per preview frame, the shell re-reads
   * `pinFrame`, and these rows follow the drag instead of stating a file the
   * gesture has not reached yet.
   */
  const precision = Object.values(active.value.attrs).some((attr) => isUnitLength(attr.value))
    ? 6
    : 0
  const writes = pin.value
    ? pinWrites(pin.value, frame.box, frame.parent, undefined, precision)
    : null
  return built.map((field) => {
    const name = field.name
    // A loose edge's dash stays a dash — the pin does not hold it, and a live
    // number there would be an offer the resolver ignores.
    if (field.readonlyReason) return field
    if (name === 'x') return { ...field, value: frame.box.x }
    if (name === 'y') return { ...field, value: frame.box.y }
    if (name === 'width' || name === 'height') {
      // A stretched size has no authored number at all, so it also claims
      // authored: the row would otherwise show a dash for a real size. A hug
      // stays a dash — its row is not authored and not pinned.
      if (pin.value && isPinnedAxis(pin.value, name)) {
        return { ...field, value: frame.box[name], authored: true }
      }
      return field.authored ? { ...field, value: frame.box[name] } : field
    }
    const converted = writes?.fields[name]
    if (converted !== undefined) return { ...field, value: converted }
    return field
  })
})
const hasStrokeEndpoints = computed(() => {
  const node = active.value
  if (node?.element !== 'Vector') return false
  const network = scenePropFor('vectorPaths', node.attrs.vectorPaths?.value ?? [])?.vectorNetwork
  return vectorEndpoints(network).length === 2
})
const textDirection = computed(() => {
  const field = fields.value.find((field) => field.name === 'textDirection')
  const value = field?.boundTo ? props.tokens?.get(field.boundTo) : field?.value
  return value === 'RTL' ? 'rtl' : value === 'LTR' ? 'ltr' : 'auto'
})
const sections = computed(() => {
  const node = active.value
  if (!node) return []
  const displayFields = fields.value.map((field) =>
    isStrokeEndpointProp(field.name) && !field.authored
      ? { ...field, value: node.attrs.strokeCap?.value ?? 'NONE' }
      : field,
  )
  return sectionsFor(node, displayFields, parent.value)
})
/**
 * The fill this node is, or null (story F5, ADR 0007 §2).
 *
 * A fill carries `name` and nothing else, so `sectionsFor` gives it no rows and
 * the pane would otherwise be blank — which is the wrong answer for a node that
 * has two things an author plainly wants to do to it. Figma puts slot actions
 * in this panel too.
 */
const fillSlot = computed(() =>
  active.value && props.doc && resetSlotFor(props.doc, active.value.address) ? active.value : null,
)

/** Whether emptying it would say anything — a fill with no children is already empty. */
const fillHasContents = computed(() => (fillSlot.value?.children.length ?? 0) > 0)

/**
 * Whether this node could become a hole, and the patch that would do it.
 *
 * In this panel rather than the toolbar because it is a fact about the selected
 * node, not a mode the editor is in: the five drawing tools up there are things
 * you arm and then use, and this is a thing you do to what is already selected.
 * It also means the button can appear for *every* element that could convert
 * rather than for one the toolbar happened to be told about.
 */
const convertible = computed(() =>
  props.doc && active.value ? convertibleToSlot(props.doc, [active.value.address]) : null,
)

/**
 * Turn it into a slot, in place.
 *
 * One `retag` (F14), so the children, their comments and the layout the author
 * arranged stay exactly where they are — the canvas does not move, which is the
 * difference between a retrofit and a rebuild. The address does not change
 * either, so the selection survives without remapping.
 */
function convertToSlot(): void {
  const made =
    props.doc && convertible.value ? convertToSlotFor(props.doc, [convertible.value]) : null
  if (made) emit('patches', made.patches)
}

/**
 * Reset and empty, both straight at the document.
 *
 * Through `patches` rather than `commit`, for the reason F6 gives one line up:
 * `commit` routes through the scene graph, and neither of these is a scene
 * property — removing a node and removing its children are structural.
 */
function resetFill(): void {
  const node = fillSlot.value
  const patches = node && props.doc ? resetSlotFor(props.doc, node.address) : null
  if (patches) emit('patches', patches)
}

function emptyFill(): void {
  const node = fillSlot.value
  const patches = node && props.doc ? deleteSlotContentsFor(props.doc, node.address) : null
  if (patches) emit('patches', patches)
}

/** Props the prop table does not know — no section to sit in, shown flat as C5 always has. */
const unmapped = computed(() => fields.value.filter((f) => f.group === null))

/**
 * Open/closed per section, keyed by group rather than by node — a `ref`
 * declared once, so collapsing "Appearance" survives selecting a different
 * node (story C6's "Done when").
 */
const openSections = ref<Record<PropGroup, boolean>>(
  Object.fromEntries(SECTION_ORDER.map((group) => [group, true])) as Record<PropGroup, boolean>,
)

/**
 * The export question, for as long as it is open.
 *
 * Held beside `openSections` and for the same reason — a ref declared once, so
 * the answer survives selecting a different node. It is deliberately *not*
 * written anywhere else: a layer carries no export list, because a saved
 * setting nobody re-reads is a saved setting that lies about a size that has
 * since changed. PNG at 2x is the answer most often wanted, so it is the one
 * the section opens on.
 */
const exportOpen = ref(true)
const exportFormat = ref<ExportFormat>('PNG')
const exportScale = ref(2)

/** SVG is resolution-independent, so the scale is not a question it answers. */
const scaleApplies = computed(() => exportFormat.value !== 'SVG')

const exportPixels = computed(() =>
  props.exportBounds && scaleApplies.value
    ? pixelSizeFor(props.exportBounds, exportScale.value)
    : null,
)

const exportFileName = computed(() => {
  const name = active.value?.attrs.name?.value
  return fileNameFor(typeof name === 'string' ? name : '', exportFormat.value, exportScale.value)
})

/**
 * An SVG needs bounds but no pixel count, so "can this be exported" cannot be
 * read off `exportPixels` alone — under SVG that is always null.
 */
const canExport = computed(
  () => !!props.exportBounds && !!pixelSizeFor(props.exportBounds, exportScale.value),
)

function onExportScale(event: Event): void {
  exportScale.value = clampScale(Number((event.target as HTMLInputElement).value))
}

function onExport(): void {
  const address = active.value?.address
  if (!address || !canExport.value) return
  emit('export', {
    address,
    format: exportFormat.value,
    scale: exportScale.value,
    fileName: exportFileName.value,
  })
}

/**
 * `status` and `version` as chips rather than editable rows.
 *
 * They describe the component instead of styling it, which is why
 * `editableProps` leaves them out — and why the panel has to show them
 * somewhere, or the fact a reviewer scans for is in the file and invisible in
 * the app. A chip is that somewhere: it reads at a glance and it does not
 * pretend to be a control for something the prop table cannot write.
 */
const meta = computed<{ name: string; value: string }[]>(() => {
  const node = active.value
  if (!node) return []
  return [...METADATA_ATTRS].flatMap((name) => {
    const value = node.attrs[name]?.value
    return typeof value === 'string' ? [{ name, value }] : []
  })
})

/** What a bound row displays: the token's value, since the literal is elsewhere. */
function resolved(field: EditableProp): number | null {
  const value = field.boundTo ? props.tokens?.get(field.boundTo) : field.value
  return LENGTH_PROPS.has(field.name)
    ? lengthToPx(value, rootFontSize.value)
    : typeof value === 'number'
      ? value
      : null
}

/**
 * The value a gesture is showing, which the document does not have.
 *
 * `NumberFieldRoot` is a controlled component: it renders `model-value` and
 * nothing else. A preview deliberately never reaches the document — that is
 * what keeps a five-second drag down to one patch — so the value `resolved`
 * reads cannot move while a scrub is in flight. Those two facts together
 * left the panel showing the committed number for the whole gesture while the
 * canvas reflowed beside it, so the previewed one is held here and fed down.
 *
 * Held for the gesture and nothing longer. It is dropped on commit, so at rest
 * the file is what the panel reads. A document arriving mid-gesture does *not*
 * drop it: the file is the source of truth and its changes land whenever they
 * land, but the one property under the author's finger is theirs until they let
 * go. Only the previewed node leaving the file reclaims the row early — there
 * is nothing left for the scrub to be editing.
 */
/**
 * What this field may be linked to, or null when it may not be linked at all.
 *
 * Asked per row rather than once per node because the answer is per *field*:
 * a `<Text>` inside a component offers its TEXT properties on `characters` and
 * its BOOLEAN ones on `visible`, and nothing on `fontSize`.
 */
function candidatesFor(field: EditableProp) {
  const address = active.value?.address
  if (!props.doc || !address) return null
  return bindCandidates(props.doc, address, field.name)
}

/**
 * The variables this field's control can read, from every loaded token doc.
 *
 * Filtered by the field's own property as well as its type since G8, so the
 * corner-radius picker stops listing the spacing scale.
 */
function variablesFor(field: EditableProp): VariableCandidate[] {
  return variableCandidates(
    props.tokens,
    props.tokenIndex,
    variableTypeForControl(propUiFor(field.name)?.control ?? field.control),
    field.name,
  )
}

/** Preserve aliases in compound controls, including inherited corner radii. */
const tokenSource = computed<TokenBindingSource>(() => {
  const bindings: Record<string, string> = {}
  for (const field of fields.value) {
    if (field.boundTo?.includes('#')) bindings[field.name] = field.boundTo
  }
  if (bindings.cornerRadius) {
    for (const name of CORNER_PROPS) {
      if (!active.value?.attrs[name]) bindings[name] = bindings.cornerRadius
    }
  }
  return { tokens: props.tokens, tokenIndex: props.tokenIndex, bindings }
})

function onBindVariables(names: string[], token: string): void {
  if (!props.doc || !active.value || props.writable === false) return
  preview.value = null
  const patches = names.flatMap(
    (name) => bindVariable(props.doc!, active.value!.address, name, token) ?? [],
  )
  if (patches.length) emit('patches', patches)
}

function onDetachVariables(writes: TokenDetachWrite[]): void {
  if (!props.doc || !active.value || props.writable === false) return
  preview.value = null
  const patches = writes.flatMap(
    ({ prop, value }) => detachVariable(props.doc!, active.value!.address, prop, value) ?? [],
  )
  if (patches.length) emit('patches', patches)
}

/** The component enclosing the active node, for the popup's property heading. */
const componentName = computed(() => {
  const address = active.value?.address
  return address && props.doc ? (enclosingComponent(props.doc, address)?.name ?? null) : null
})

/** A variable chosen from a popup, bound to the field it was opened from. */
function onPickVariable(prop: string, token: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = bindVariable(props.doc, address, prop, token)
  if (patches) emit('patches', patches)
}

/** The selected node's own mode selection, or undefined when it sets none (G8). */
const explicitModes = computed<Record<string, string> | undefined>(() => {
  const value = active.value?.attrs.modes?.value
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, string>)
    : undefined
})

/**
 * Applying a mode is a structural write, like binding a variable.
 *
 * `modes` is in `STRUCTURAL_PROPS`, so no scene node ever carries it and the
 * commit route has nothing to write — the patch says what the file should hold.
 */
function onSetMode(collection: string, mode: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = setNodeMode(props.doc, address, collection, mode)
  if (patches) emit('patches', patches)
}

function onClearMode(collection: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = clearNodeMode(props.doc, address, collection)
  if (patches) emit('patches', patches)
}

/**
 * The instance-swap row: `component` on an `<Instance>` (parity spec §2).
 *
 * It is not one of `fields` and cannot be — `component` is a `STRUCTURAL_PROP`,
 * so `scenePropFor` stops it and no scene node ever carries it. That is also
 * why it sits above the sections rather than inside one: Figma puts the swap
 * control at the top of the panel, and here the structure agrees.
 */
const swapRow = computed(() => {
  const node = active.value
  if (!props.doc || !node || node.element !== 'Instance') return null
  const held = node.attrs.component?.value
  const boundTo = held !== undefined ? aliasTarget(held) : null
  return {
    boundTo,
    component: typeof held === 'string' ? held : '',
    candidates: bindCandidates(props.doc, node.address, 'component'),
  }
})

/**
 * The one input each section can bind, and its current state.
 *
 * Figma applies a property from the section that owns the input — "Boolean
 * property: the Appearance section", "Text property: the Text section" — so
 * the control belongs to the header, not to every row. That also keeps the
 * rows clean: one glyph per section rather than one per bindable field.
 *
 * Null when the section owns no bindable input, or when the layer sits outside
 * a component and nothing may be linked at all.
 */
const SECTION_INPUT: Partial<Record<PropGroup, string>> = {
  text: 'characters',
  appearance: 'visible',
}

function sectionLink(group: PropGroup) {
  const prop = SECTION_INPUT[group]
  const node = active.value
  if (!prop || !props.doc || !node) return null
  const candidates = bindCandidates(props.doc, node.address, prop)
  const held = node.attrs[prop]?.value
  const target = held !== undefined ? aliasTarget(held) : null
  // Either binding moves the action from the header to the bound value.
  return {
    prop,
    boundTo: target,
    candidates,
    variables: variableCandidates(
      props.tokens,
      props.tokenIndex,
      prop === 'visible' ? 'BOOLEAN' : 'STRING',
      prop,
    ),
  }
}

/**
 * The binding driving `visible` — property or token — or null. Either kind
 * stills the eye: a stray click must not silently detach it.
 *
 * (The Appearance eye used to read a `visibleLink = sectionLink('appearance')`
 * computed instead, which only ever saw a *property* binding — a token alias
 * slipped past it, leaving the eye live and a stray click free to silently
 * detach the variable. `visibleBound` reads the field's `boundTo` directly,
 * which is set for either kind of alias.)
 */
const visibleBound = computed(() => fields.value.find((f) => f.name === 'visible')?.boundTo ?? null)

/** Sections whose header carries Figma's `+` — each appends to one list prop. */
const ADDABLE: Partial<Record<PropGroup, 'fills' | 'strokes' | 'effects'>> = {
  fill: 'fills',
  stroke: 'strokes',
  effects: 'effects',
}

/** Each addable attr's parser: turns its array value into panel-editable rows. */
const ADDABLE_PARSER: Record<
  'fills' | 'strokes' | 'effects',
  (value: JsonValue) => unknown[] | null
> = { fills: asPaints, strokes: asPaints, effects: asEffects }

/**
 * Whether the section's `+` must be disabled (Finding 3): its field holds a
 * non-empty array the relevant parser rejects, which only happens when an
 * entry carries a variable the parser has no literal for (`asEffects`
 * expects a literal `Rgba` `color`, not an alias string, for instance).
 *
 * A click in that state used to compute e.g. `addEffect(asEffects(value)) =
 * addEffect(null) = [defaultShadow]` — replacing the whole attribute and
 * deleting every hand-authored alias entry in it. Disabling the button is
 * what stops that; an unauthored (null) or literal (parses fine) value never
 * trips this.
 */
function sectionAddDisabled(group: PropGroup): boolean {
  const prop = ADDABLE[group]
  const value = prop ? fields.value.find((f) => f.name === prop)?.value : undefined
  if (!prop || !Array.isArray(value) || value.length === 0) return false
  return ADDABLE_PARSER[prop](value) === null
}

function onSectionAdd(group: PropGroup): void {
  const prop = ADDABLE[group]
  const field = fields.value.find((f) => f.name === prop)
  if (!prop || !field || sectionAddDisabled(group)) return
  const next =
    prop === 'effects' ? addEffect(asEffects(field.value)) : addSolidPaint(asPaints(field.value))
  onCommit(prop, next)
}

/**
 * Whether this row reads a component property rather than a literal.
 *
 * The address fact F6 settled: a token's global name always contains `#` and a
 * property name may not, so a bare target is a property. A token row is not
 * marked — it keeps its label and its resolved value, which is the point of it.
 */
function isPropertyBound(field: EditableProp): boolean {
  return field.boundTo !== null && !field.boundTo.includes('#')
}

/** Linking and unlinking are structural: they go at the document, like `props`. */
function onLink(prop: string, name: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = bindProperty(props.doc, address, prop, name)
  if (patches) emit('patches', patches)
}

/**
 * The field that asked for a new property, while the dialog is open.
 *
 * Held here rather than in the row because the submit has to reach the
 * *component's* `props` as well as the row's own attribute, and the pane is
 * what knows both addresses.
 */
// `shallowRef` for `JsonValue`'s sake: it is recursive, and deep unwrapping it
// is a type instantiation TypeScript gives up on.
const creating = shallowRef<{ prop: string; type: PropertyType; value: JsonValue } | null>(null)

function onCreate(prop: string): void {
  const type = propertyTypeForField(prop)
  const node = active.value
  if (!type || !node) return
  // Seeded from the literal the field holds, so declaring a property and
  // linking to it leaves the canvas exactly as it was — Figma's behaviour, and
  // the reason the gesture feels safe enough to try.
  const held = node.attrs[prop]?.value
  const literal = held !== undefined && aliasTarget(held) === null ? held : defaultFor(type)
  creating.value = { prop, type, value: literal }
}

/** Refusals keep the dialog open: the name is taken, and the author must see it. */
function onCreateSubmit(name: string, value: JsonValue): void {
  const address = active.value?.address
  const pending = creating.value
  if (!props.doc || !address || !pending) return
  const patches = declareAndBindProperty(props.doc, address, pending.prop, name, value)
  if (!patches) return
  emit('patches', patches)
  creating.value = null
}

/** The property the popup's ⚙ opened for editing, while the dialog is up. */
const editing = shallowRef<{ from: string; type: PropertyType; value: JsonValue } | null>(null)

/**
 * By declaration name, not by field: the ⚙ sits on the popup's rows (Figma's
 * own placement), so the author can edit any listed property — bound to this
 * field or not. The old field-shaped path derived the name from the field's
 * bound attribute, which also meant it silently did nothing for anything the
 * field did not currently link to.
 */
function onEditDeclaration(name: string): void {
  const node = active.value
  if (!props.doc || !node) return
  const component = enclosingComponent(props.doc, node.address)
  const declaration = component ? componentProps(component).declared.get(name) : undefined
  if (!declaration) return
  editing.value = { from: name, type: declaration.type, value: declaration.default }
}

function onEditSubmit(name: string, value: JsonValue): void {
  const address = active.value?.address
  const pending = editing.value
  if (!props.doc || !address || !pending) return
  // `editProperty` writes the component's `props`, so it wants *that*
  // address — the same climb `onEditDeclaration` made to find the declaration.
  const component = enclosingComponent(props.doc, address)
  if (!component) return
  const patches = editProperty(props.doc, component.address, pending.from, name, value)
  if (!patches) return
  emit('patches', patches)
  editing.value = null
}

function onUnlink(prop: string): void {
  const address = active.value?.address
  if (!props.doc || !address) return
  const patches = unbindProperty(props.doc, address, prop)
  if (patches) emit('patches', patches)
}

/**
 * One value per prop rather than one prop, because a compound control scrubs
 * several at once: the collapsed corner box writes four radii, the padding
 * axis writes both sides. Every one of them has to move with the pointer.
 */
const preview = ref<{ address: string; values: Record<string, number> } | null>(null)

watch(
  () => props.doc,
  (doc) => {
    const held = preview.value
    if (held && doc && resolve(doc.tree, held.address)) return
    preview.value = null
  },
)

/** The value a gesture is showing for a prop of the active node, or null at rest. */
function heldNumber(prop: string): number | null {
  const held = preview.value
  if (!held || held.address !== active.value?.address) return null
  return held.values[prop] ?? null
}

function heldFor(field: EditableProp): number | null {
  return heldNumber(field.name)
}

const editable = (field: EditableProp): boolean =>
  props.writable !== false && field.readonlyReason === null

function onPreview(prop: string, value: JsonValue): void {
  if (!active.value) return
  const address = active.value.address
  const px = LENGTH_PROPS.has(prop) ? lengthToPx(value, rootFontSize.value) : value
  if (typeof px === 'number') {
    const held = preview.value?.address === address ? preview.value.values : {}
    preview.value = { address, values: { ...held, [prop]: px } }
  }
  emit('preview', address, prop, value)
}

/** A compound control's scrub: one preview per prop it writes. */
function onMultiPreview(writes: Array<{ prop: string; value: JsonValue }>): void {
  for (const write of writes) onPreview(write.prop, write.value)
}

/** The value a prop currently has, falling back to the SDK's own default. */
function valueOf(prop: string, fallback: string): string {
  const field = fields.value.find((f) => f.name === prop)
  return typeof field?.value === 'string' ? field.value : fallback
}

/**
 * Props the rebuilt Auto layout section draws itself. They keep their place in
 * the file and in `editableProps`; what changes is that the section shows them
 * through one control apiece instead of a generic row each, so the panel reads
 * the way the reference does.
 */
const HANDLED_BY_SECTION: ReadonlySet<string> = new Set([
  'primaryAxisAlignItems',
  'counterAxisAlignItems',
  'primaryAxisSizingMode',
  'counterAxisSizingMode',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'width',
  'height',
  // The Resizing switch leads the section instead (above Dimensions), so the
  // generic rows must not render it a second time.
  'textAutoResize',
])

/** The rows a section still renders generically, once its own controls have taken theirs. */
function genericFields(section: PropSection): PropSection['fields'] {
  const handled = (name: string): boolean =>
    (active.value?.element === 'Vector' && name === 'vectorPaths') ||
    (isStrokeEndpointProp(name) && !hasStrokeEndpoints.value) ||
    (name === 'strokeCap' && hasStrokeEndpoints.value) ||
    (active.value?.element === 'Vector' &&
      ['strokeTopWeight', 'strokeRightWeight', 'strokeBottomWeight', 'strokeLeftWeight'].includes(
        name,
      )) ||
    HANDLED_BY_SECTION.has(name) ||
    // The eye on the header is this node's visibility, so the row is
    // redundant — until something drives it, which the eye cannot express.
    (name === 'visible' && !visibleBound.value) ||
    (showCorners.value && HANDLED_BY_CORNERS.has(name))
  return section.fields.filter(
    (paired) =>
      !handled(paired.field.name) && !(paired.pairedWith && handled(paired.pairedWith.name)),
  )
}

/** A number a rebuilt control reads, taking the gesture's held value first. */
function numberOf(prop: string, fallback = 0): number {
  const field = fields.value.find((f) => f.name === prop)
  if (!field) return fallback
  return heldFor(field) ?? resolved(field) ?? fallback
}

/**
 * The same, but null when the file does not author the prop at all.
 *
 * Unset rows carry the element's default, which for geometry is not what
 * *this* node resolves to — a hugging frame's height is whatever layout
 * computed, not a bare frame's 100. So W and H keep showing a dash until the
 * file says otherwise, rather than a number belonging to a different node.
 */
function authoredNumber(prop: string): number | null {
  const field = fields.value.find((f) => f.name === prop)
  if (!field || !field.authored) return null
  return heldFor(field) ?? resolved(field)
}

/**
 * The corner control takes over only when the radius is a literal. A bound
 * radius keeps its own row — C6's guarantee is that a binding is replaced
 * only by an explicit detach, and a collapse control writing through it
 * would be exactly the silent overwrite that rule exists to prevent.
 */
const cornerField = computed(() => fields.value.find((f) => f.name === 'cornerRadius') ?? null)
const CORNER_PROPS = [
  'topLeftRadius',
  'topRightRadius',
  'bottomRightRadius',
  'bottomLeftRadius',
] as const
/**
 * Authored, not merely present: since C7 every applicable prop has a row, so
 * "the file writes per-corner radii" is a question about what it authored.
 */
const hasPerCorner = computed(() =>
  fields.value.some((f) => f.authored && CORNER_PROPS.includes(f.name as never)),
)
const showCorners = computed(
  () => (cornerField.value !== null && !cornerField.value.boundTo) || hasPerCorner.value,
)

/** Each corner as the document resolves it, falling back to the shorthand. */
const cornerValues = computed<SideValues>(() => {
  const uniform = cornerField.value
    ? (heldFor(cornerField.value) ?? resolved(cornerField.value) ?? 0)
    : 0
  // A previewed corner shows whether or not the file authors it yet: the
  // collapsed box's scrub writes all four, and the unauthored ones would
  // otherwise sit still until release.
  const radius = (name: string): number =>
    heldNumber(name) ?? (active.value?.attrs[name] ? numberOf(name, uniform) : uniform)
  return {
    top: radius('topLeftRadius'),
    right: radius('topRightRadius'),
    bottom: radius('bottomRightRadius'),
    left: radius('bottomLeftRadius'),
  }
})

/** Radius props the corner control draws — only when it is the one drawing them. */
const HANDLED_BY_CORNERS: ReadonlySet<string> = new Set([
  'cornerRadius',
  ...CORNER_PROPS,
  'cornerSmoothing',
])

/** The node's effective visibility — absent means visible, as the SDK reads it. */
const isVisible = computed(() => {
  const field = fields.value.find((f) => f.name === 'visible')
  return field ? field.value !== false : true
})

const paddingValues = computed<SideValues>(() => ({
  top: numberOf('paddingTop'),
  right: numberOf('paddingRight'),
  bottom: numberOf('paddingBottom'),
  left: numberOf('paddingLeft'),
}))

/** Only an auto-layout frame has axes to align along. */
const layoutMode = computed(() => valueOf('layoutMode', 'NONE'))
const hasAutoLayout = computed(() => layoutMode.value !== 'NONE')
/** The section that owns width and height, so the Dimensions row lands with them. */
const sizeGroup = computed<PropGroup | null>(
  () => fields.value.find((f) => f.name === 'width' || f.name === 'height')?.group ?? null,
)

/**
 * A `<Text>`'s box is sized too — by its glyphs, through `textAutoResize`
 * rather than by a parent's axes. It has no `layoutMode`, so the auto-layout
 * test above answers no for it, and the W/H dropdowns rendered for a frame
 * and not for a text: the one node whose size is *most* obviously computed
 * offered no way to say so.
 */
const isText = computed(() => active.value?.element === 'Text')
const textResize = computed(() => valueOf('textAutoResize', 'NONE'))
/**
 * The sizing modes this node's W/H boxes offer, or null for a bare number.
 *
 * Hug only means something where the engine can hug — an auto-layout frame,
 * or text sized by its glyphs — so a plain frame's menu holds Fixed alone. It
 * still renders (review: the boxes should look the same on every container);
 * what a node cannot do is absent from its menu rather than the menu absent
 * from the node. Non-container shapes keep the bare number.
 */
const CONTAINERS = new Set(['Frame', 'Component', 'Slot'])
const sizeModes = computed<Array<{ value: 'FIXED' | 'AUTO'; label: string }> | null>(() => {
  if (hasAutoLayout.value || isText.value) {
    return [
      { value: 'FIXED', label: 'Fixed' },
      { value: 'AUTO', label: 'Hug' },
    ]
  }
  if (active.value && CONTAINERS.has(active.value.element)) {
    return [{ value: 'FIXED', label: 'Fixed' }]
  }
  return null
})

/** The `<Text>` Resizing switch, rendered above Dimensions the way Figma stacks them. */
const textResizeField = computed(() =>
  isText.value ? (fields.value.find((f) => f.name === 'textAutoResize') ?? null) : null,
)

/**
 * One gesture, several props: each write leaves as its own `commit` in the
 * same tick and `patch-burst` gathers them into one envelope — the same path
 * a single-prop edit takes, with nothing new in the patch plumbing.
 */
function onMultiCommit(writes: Array<{ prop: string; value: JsonValue }>): void {
  for (const write of writes) onCommit(write.prop, write.value)
}

/** Attrs whose entries may carry a color alias the scene would resolve away. */
const ALIAS_PAINT_ATTRS: ReadonlySet<string> = new Set(['fills', 'strokes'])

/** Whether any entry of a paint array reads a variable rather than a literal. */
function carriesPaintAlias(value: JsonValue | undefined): boolean {
  const paints = value === undefined ? null : asPaints(value)
  return paints !== null && paints.some((paint) => paintColorAlias(paint) !== null)
}

/**
 * One `PinWrites` split into the two halves an envelope needs in order, since
 * **the server re-parses between ops and every intermediate state has to be a
 * legal document** (`assertStillValid` in `@uidx/format`).
 *
 * That is not a detail of ordering, it is the whole shape of the envelope. A
 * pin change carries three things — the constraint, the offsets it makes
 * authored, and the attributes it makes derived — and no naive order works:
 * writing the constraint first leaves the old answer beside it (UIDX134), and
 * writing the new offset first states one the *old* constraint forbids (also
 * UIDX134). Only "take the old answers out, then ask the new question, then
 * answer it" passes through legal documents the whole way.
 *
 * Found live, by clicking the bottom edge on a node with an authored height.
 */
function pinRemovals(address: string, writes: PinWrites): UidxPatch[] {
  const attrs = active.value?.attrs ?? {}
  return writes.removals
    .filter((prop) => attrs[prop] !== undefined)
    .map((prop) => ({ op: 'remove', address, prop }))
}

/** The offsets the new pin makes the author's: an `add`, or a `set` if stated. */
function pinFields(address: string, writes: PinWrites): UidxPatch[] {
  const attrs = active.value?.attrs ?? {}
  return Object.entries(writes.fields).map(([prop, value]) => ({
    op: attrs[prop] === undefined ? 'add' : 'set',
    address,
    prop,
    value: preserveLengthUnit(value, attrs[prop]?.value, rootFontSize.value),
  }))
}

function onCommit(prop: string, value: JsonValue): void {
  if (!active.value) return
  const address = active.value.address
  /**
   * Fills and strokes route structurally, not through the scene, whenever an
   * alias is anywhere in play (the value just committed, or what the node
   * already authors).
   *
   * `App.vue`'s `onCommit` sends every commit through `canvasPane.applyProp`,
   * which mutates the scene graph and derives a patch from the *result* —
   * and the scene resolves a paint alias (schema's `resolvePaintAliases`)
   * before that patch is ever computed. So a fills value carrying
   * `color: "{palette#white}"` would reach the file as the resolved literal,
   * or — whenever the resolved colour already matches what is on screen,
   * which a fresh pick and every detach both are — produce no patch at all.
   * A patch built here, straight from the value this pane already has, is
   * the only way the binding (or its removal) reaches the file intact. This
   * is the same rule `bindVariable` states for property/token aliases,
   * extended to paint-level ones.
   *
   * Effects never need this: `asEffects` rejects a string colour, so no
   * effects value this pane can PRODUCE ever carries an alias — the effects
   * editor stays on the scene route unconditionally. It can still CLOBBER a
   * hand-authored alias effect it did not produce, though: `sectionAddDisabled`
   * (below) is what stops the header's `+` from doing that (Finding 3).
   */
  /**
   * A pin offset routes structurally, for the reason an alias-carrying paint
   * does. `App.vue` sends every `commit` through `canvasPane.applyProp`, which
   * mutates the scene graph and derives a patch from the result — and the
   * graph has no `right`, `bottom`, `centerX` or `centerY` to derive one from
   * (ADR 0011 §2). A scene-routed pin edit is a write that vanishes without
   * saying so.
   */
  /**
   * Choosing a pin rewrites the geometry in the same envelope, so the child
   * does not move. `positioningWrites` does this for the absolute-position
   * toggle and for the same reason: a gesture that changes what a number
   * *means* has to change the number with it, or the author watches their
   * layout jump for a decision they thought was about behaviour.
   */
  if (prop === 'constraints' && (props.pinFrame ?? docPinFrame.value)) {
    const next = value as { horizontal: PinAxis; vertical: PinAxis }
    preview.value = null
    // Only the axis the click moved. Converting the other one rewrites a line
    // the author did not touch, from a measured box — so a stale measurement
    // would corrupt an axis the gesture had nothing to do with.
    const current = pin.value ?? { horizontal: 'MIN' as PinAxis, vertical: 'MIN' as PinAxis }
    const moved = (['horizontal', 'vertical'] as const).filter(
      (axis) => next[axis] !== current[axis],
    )
    if (moved.length === 0) return
    const liveFrame = (props.pinFrame ?? docPinFrame.value)!
    const writes = pinWrites(next, liveFrame.box, liveFrame.parent, moved)
    emit('patches', [
      // Out, then the question, then the answers. See `pinRemovals`.
      ...pinRemovals(address, writes),
      {
        op: active.value.attrs.constraints === undefined ? 'add' : 'set',
        address,
        prop,
        value,
      },
      ...pinFields(address, writes),
    ])
    return
  }

  if (
    PIN_PROPS.includes(prop) ||
    (prop === 'effects' &&
      (hasLengthUnits(prop, value) ||
        hasLengthUnits(prop, active.value.attrs[prop]?.value ?? null)))
  ) {
    preview.value = null
    emit('patches', [
      { op: active.value.attrs[prop] === undefined ? 'add' : 'set', address, prop, value },
    ])
    return
  }

  if (
    ALIAS_PAINT_ATTRS.has(prop) &&
    (carriesPaintAlias(value) || carriesPaintAlias(active.value.attrs[prop]?.value))
  ) {
    preview.value = null
    emit('patches', [
      { op: active.value.attrs[prop] === undefined ? 'add' : 'set', address, prop, value },
    ])
    return
  }
  // The gesture is over, so the row goes back to reading the document — which
  // is still a beat behind, and catches up when the write echoes back.
  preview.value = null
  emit('commit', address, prop, value)
}

/**
 * A token pill's detach, for any type (Finding 2). The scene already renders
 * the resolved value the pill shows, so routing this through `onCommit` (and
 * from there, `App.vue`'s scene-derived patch) would produce no scene change
 * and therefore no patch at all — the same trap the alias-paint branch above
 * closes for fills/strokes, generalized to every bound field. The attribute
 * is authored by definition whenever a field is bound, so this is always a
 * `set`, never an `add`.
 */
/**
 * Detaching writes the value the token resolved to, never a blank (G8).
 *
 * `value` arrives already resolved in this node's own mode, because the pane
 * is handed the selection-aware token map — so detaching inside a dark subtree
 * writes the dark literal rather than the default-mode one.
 */
function onDetach(prop: string, value: JsonValue): void {
  if (!props.doc || !active.value) return
  preview.value = null
  const patches = detachVariable(props.doc, active.value.address, prop, value)
  if (patches) emit('patches', patches)
}
</script>

<template>
  <aside class="properties">
    <header class="inspector-header">
      <div class="inspector-title">
        <h2>Design</h2>
        <span v-if="writable === false" class="read-only-badge">Read only</span>
      </div>
      <div v-if="active" class="node-head">
        <span class="element">{{ active.element }}</span>
        <span class="name">{{ active.name }}</span>
        <span
          v-for="chip in meta"
          :key="chip.name"
          class="meta"
          :data-meta="chip.name"
          :data-value="chip.value"
          :title="chip.name"
          >{{ chip.value }}</span
        >
      </div>
    </header>

    <p v-if="!active" class="note">
      {{
        (selection?.length ?? 0) > 1
          ? 'Select a single layer to edit its properties.'
          : 'Select a layer to adjust its size, layout, and appearance.'
      }}
    </p>
    <p v-else-if="writable === false" class="note warn">
      Reconnect to edit. You can still inspect properties and export.
    </p>

    <!--
      A fill's two states, as the two gestures that reach them (ADR 0007 §2).
      Reset removes the fill and the definition's default returns; empty keeps
      the fill and draws nothing on purpose. They are different documents, so
      they are different buttons.
    -->
    <GraphicsSection
      v-if="active?.element === 'Vector'"
      :node="active"
      :info="vectorInfo"
      :writable="writable !== false"
      :can-make-component="canMakeComponent === true"
      @edit="emit('editVector', $event)"
      @finish="emit('finishVector')"
      @action="emit('vectorAction', $event)"
      @make-component="emit('makeComponent')"
      @patches="emit('patches', $event)"
    />
    <section v-if="fillSlot" class="fill-actions">
      <p class="note">
        This fills the slot <strong>{{ fillSlot.name }}</strong
        >. Its layout belongs to the component that declares it; what is inside is this
        page&rsquo;s.
      </p>
      <div class="fill-buttons">
        <button
          type="button"
          :disabled="writable === false"
          title="Remove the fill — the component's default content comes back"
          @click="resetFill"
        >
          Reset slot
        </button>
        <button
          type="button"
          :disabled="writable === false || !fillHasContents"
          title="Keep the fill and empty it — the slot draws nothing"
          @click="emptyFill"
        >
          Delete contents
        </button>
      </div>
    </section>

    <section
      v-if="!active && doc && !doc.tree.synthetic && (selection?.length ?? 0) === 0"
      class="root-size-setting"
    >
      <label class="field-caption" for="root-font-size">Root font size</label>
      <div class="root-size-input">
        <input
          id="root-font-size"
          type="number"
          min="1"
          step="1"
          :value="rootFontSize"
          :disabled="writable === false"
          @change="changeRootSize"
          @blur="changeRootSize"
          @keydown.enter="changeRootSize"
        />
        <span>px</span>
      </div>
      <p class="note">1rem = {{ rootFontSize }}px</p>
    </section>
    <!-- The editor for the one selected node. -->
    <section v-if="active" class="editor">
      <!--
        Making a hole out of what is already there (story F5, ADR 0007 §6).
        Offered for anything whose attributes would still mean something on a
        `<Slot>`, which is a question `prop-ui.ts` answers per element — so this
        appears on a frame and a bare rectangle, and not on a text or a vector.

        Under the node's identity rather than above it: the chip says what is
        selected and the button says what may be done to it, and reading them
        the other way round asks the author to act before they have been told
        what on.
      -->
      <div v-if="convertible" class="node-actions">
        <button
          type="button"
          :disabled="writable === false"
          title="Turn this into a slot — it keeps its layout, and its children become the default content"
          @click="convertToSlot"
        >
          Convert to slot
        </button>
      </div>
      <!--
        Above the layer's own, the way Figma stacks them, and named apart from
        them because this repo already calls a scene attribute a "property"
        (F6's own warning).
      -->
      <!--
        Which component an instance is, before what it says: Figma's swap
        control is the top row of the panel, and a swap changes every property
        below it.
      -->
      <div
        v-if="swapRow"
        class="instance-swap-row"
        :data-linked="swapRow.boundTo ? 'true' : undefined"
      >
        <label>Component</label>
        <span v-if="!swapRow.boundTo" class="swap-name">{{ swapRow.component }}</span>
        <PropertyLink
          :bound-to="swapRow.boundTo"
          :candidates="swapRow.candidates"
          icon="prop-instance"
          :editable="writable !== false"
          :variables="[]"
          :component-name="componentName"
          @link="(name) => onLink('component', name)"
          @unlink="onUnlink('component')"
          @create="onCreate('component')"
          @edit="onEditDeclaration"
        />
      </div>

      <!--
        An instance's own properties come first: using a component is choosing
        its content, and the geometry below is the only other thing an instance
        lets anyone change.
      -->
      <InstancePropsSection
        v-if="active.element === 'Instance'"
        :doc="doc"
        :instance="active"
        :definition="definitionFor(active)"
        :writable="writable !== false"
        @patches="emit('patches', $event)"
      />

      <!--
        A component's states come before its properties: a state is the coarser
        fact — which button this is, before what it says.
      -->
      <ComponentVariantsSection
        v-if="active.element === 'Component' && active.attrs.variants !== undefined"
        :doc="doc"
        :component="active"
        :pages="pages"
        :file="file"
        :writable="writable !== false"
        @patches="emit('patches', $event)"
        @remap="emit('remap', $event)"
        @refused="emit('refused', $event)"
      />

      <ComponentPropsSection
        v-if="active.element === 'Component'"
        :pages="pages"
        :file="file"
        :doc="doc"
        :component="active"
        :writable="writable !== false"
        @remap="emit('remap', $event)"
        @patches="emit('patches', $event)"
      />

      <p v-if="!fields.length" class="note">This node declares no properties.</p>

      <PropertySectionRoot
        v-for="section in sections"
        :key="section.group"
        :open="openSections[section.group]"
        class="section"
        :aria-label="section.label"
        @update:open="openSections[section.group] = $event"
      >
        <!-- The header is inert markup; the primitive hands the toggle back
             through its slot, so the click has to be wired here. The chevron
             turns with data-state, Figma's own affordance. -->
        <PropertySectionHeader v-slot="{ actions, stateAttrs }" class="section-head">
          <button
            type="button"
            class="section-toggle"
            v-bind="stateAttrs"
            :aria-expanded="openSections[section.group]"
            @click="actions.toggle()"
          >
            <PropertySectionTitle class="section-title">{{ section.label }}</PropertySectionTitle>
            <span class="chevron" aria-hidden="true">›</span>
          </button>
          <!-- Figma hangs the node's visibility off the Appearance header
               rather than burying it in a checkbox row. -->
          <button
            v-if="section.group === 'appearance'"
            type="button"
            class="cluster-btn section-eye"
            :disabled="writable === false || !!visibleBound"
            :title="
              visibleBound
                ? `visibility is linked to ${visibleBound}`
                : isVisible
                  ? 'hide this node'
                  : 'show this node'
            "
            :aria-label="isVisible ? 'hide' : 'show'"
            :aria-pressed="!isVisible"
            @click="onCommit('visible', !isVisible)"
          >
            <FieldIcon :name="isVisible ? 'eye' : 'eye-off'" />
          </button>
          <!--
            The boolean apply flow, beside the eye it fills — Figma's own
            placement ("Boolean property: the Appearance section"). Only while
            unbound: once a property drives visibility the pill is a row in the
            section body, because a header is a fixed line beside a title and a
            chevron, and a property name of any length overflows it. Figma puts
            the pill in the section for the same reason.
          -->
          <span
            v-for="link in [sectionLink(section.group)].filter((l) => l && !l.boundTo)"
            :key="link!.prop"
            class="section-link"
          >
            <PropertyLink
              :bound-to="null"
              :candidates="link!.candidates"
              :icon="link!.prop === 'visible' ? 'prop-boolean' : 'prop-text'"
              :editable="writable !== false"
              :variables="link!.variables"
              allow-variables
              :variable-label="link!.prop === 'visible' ? 'Visibility' : 'Content'"
              :component-name="componentName"
              @link="(name) => onLink(link!.prop, name)"
              @unlink="onUnlink(link!.prop)"
              @create="onCreate(link!.prop)"
              @pick-variable="(a) => onPickVariable(link!.prop, a)"
            />
          </span>
          <!-- Fill/Stroke/Effects append here, Figma's placement — the
               in-field header row these buttons used to sit in is gone. -->
          <button
            v-if="ADDABLE[section.group]"
            type="button"
            class="cluster-btn"
            :data-section-add="section.group"
            :aria-label="`Add ${section.group === 'effects' ? 'effect' : section.group}`"
            :disabled="writable === false || sectionAddDisabled(section.group)"
            :title="
              sectionAddDisabled(section.group)
                ? `${ADDABLE[section.group]} the panel cannot edit — authored with variables; edit the file`
                : `add ${section.group === 'effects' ? 'an effect' : 'a solid paint'}`
            "
            @click="onSectionAdd(section.group)"
          >
            <FieldIcon name="plus" />
          </button>
        </PropertySectionHeader>
        <PropertySectionContent class="section-body">
          <!--
            Figma's **Apply variable mode**, in the Appearance section it puts
            it in (G8). Leads the section because a mode governs every value
            below it: changing it re-resolves the rows underneath, so reading
            it after them would explain the numbers only in hindsight.
          -->
          <ModeRow
            v-if="section.group === 'appearance'"
            :token-index="tokenIndex"
            :explicit="explicitModes"
            :editable="writable !== false"
            @set="onSetMode"
            @clear="onClearMode"
          />

          <!--
            A `<Text>`'s Resizing switch leads the section, above Dimensions —
            Figma's own stacking, and the reason this is rendered here rather
            than left to the generic rows below (which would put it after
            every dimension it governs). `HANDLED_BY_SECTION` keeps it from
            also appearing there.
          -->
          <div
            v-if="textResizeField && section.group === sizeGroup"
            class="field"
            :data-prop="textResizeField.name"
            @mouseenter="onHover(textResizeField.name)"
            @mouseleave="onHover(null)"
          >
            <PropertyField
              :field="textResizeField"
              :resolved-value="resolved(textResizeField)"
              :held-value="heldFor(textResizeField)"
              :editable="editable(textResizeField)"
              :swatches="swatches"
              :tokens="tokens"
              :token-index="tokenIndex"
              @preview="onPreview"
              @commit="onCommit"
            />
          </div>

          <!--
            Dimensions: W and H each carry the Hug/Fixed state that governs
            them, replacing the separate sizing-mode rows (§5). Figma's own
            word for this row — "Resizing" names the switch above, and the two
            sharing a caption is what made the panel read as one broken
            control instead of two working ones. Renders in the section that
            owns width and height, so a node with no auto layout still gets
            its box — it just has no Hug to offer unless it is a `<Text>`,
            whose glyphs size it.
          -->
          <DimensionsField
            v-if="sizeGroup && section.group === sizeGroup && active"
            :element="active.element"
            :layout-mode="layoutMode"
            :primary-axis-sizing="valueOf('primaryAxisSizingMode', 'FIXED')"
            :counter-axis-sizing="valueOf('counterAxisSizingMode', 'FIXED')"
            :text-resize="textResize"
            :width="authoredNumber('width')"
            :height="authoredNumber('height')"
            :modes="sizeModes"
            :editable="writable !== false"
            :token-source="tokenSource"
            @bind="onBindVariables"
            @detach="onDetachVariables"
            @preview="onPreview"
            @commit="onCommit"
            @hover="onHover"
          />

          <InspectorGroup
            v-for="group in inspectorGroups(section.group, genericFields(section))"
            :key="group.id"
            :group="group"
          >
            <div v-if="group.id === 'layout-spacing' && hasAutoLayout" class="field field-align">
              <span class="field-caption">Alignment</span>
              <AlignmentMatrix
                :primary="valueOf('primaryAxisAlignItems', 'MIN')"
                :counter="valueOf('counterAxisAlignItems', 'MIN')"
                :layout-mode="layoutMode"
                :editable="writable !== false"
                @commit="onMultiCommit"
                @hover="onHover"
              />
            </div>

            <template v-for="paired in group.fields" :key="paired.field.name">
              <div
                v-if="paired.pairedWith"
                class="field field-pair"
                :data-prop="paired.field.name"
                :data-authored="paired.field.authored || paired.pairedWith?.authored"
                :title="paired.field.readonlyReason ?? undefined"
                @mouseenter="onHover(paired.field.name)"
                @mouseleave="onHover(null)"
              >
                <!--
                One caption above each half — Left | Right, Top | Bottom, Line
                height | Letter spacing. The x pair used to carry one spanning
                "Position" caption with letters inside the boxes instead;
                review preferred every edge named the same way, above.
              -->
                <div class="pair-captions">
                  <span class="field-caption">{{ paired.field.label }}</span>
                  <span class="field-caption">{{ paired.pairedWith.label }}</span>
                </div>
                <div class="pair-grid">
                  <div
                    class="field-cell"
                    :data-prop="paired.field.name"
                    @mouseenter="onHover(paired.field.name)"
                    @mouseleave="onHover(null)"
                  >
                    <PropertyField
                      :field="paired.field"
                      :resolved-value="resolved(paired.field)"
                      :held-value="heldFor(paired.field)"
                      :editable="editable(paired.field)"
                      :swatches="swatches"
                      :candidates="candidatesFor(paired.field)"
                      :variables="variablesFor(paired.field)"
                      :component-name="componentName"
                      :tokens="tokens"
                      :token-index="tokenIndex"
                      compact
                      @preview="onPreview"
                      @commit="onCommit"
                      @link="onLink"
                      @unlink="onUnlink"
                      @create="onCreate"
                      @edit="onEditDeclaration"
                      @pick-variable="onPickVariable"
                      @detach="onDetach"
                    />
                  </div>
                  <div
                    class="field-cell"
                    :data-prop="paired.pairedWith.name"
                    :title="paired.pairedWith.readonlyReason ?? undefined"
                    @mouseenter="onHover(paired.pairedWith.name)"
                    @mouseleave="onHover(null)"
                  >
                    <PropertyField
                      :field="paired.pairedWith"
                      :resolved-value="resolved(paired.pairedWith)"
                      :held-value="heldFor(paired.pairedWith)"
                      :editable="editable(paired.pairedWith)"
                      :swatches="swatches"
                      :candidates="candidatesFor(paired.pairedWith)"
                      :variables="variablesFor(paired.pairedWith)"
                      :component-name="componentName"
                      :tokens="tokens"
                      :token-index="tokenIndex"
                      compact
                      @preview="onPreview"
                      @commit="onCommit"
                      @link="onLink"
                      @unlink="onUnlink"
                      @create="onCreate"
                      @edit="onEditDeclaration"
                      @pick-variable="onPickVariable"
                      @detach="onDetach"
                    />
                  </div>
                </div>
              </div>
              <div
                v-else
                class="field"
                :class="{ 'field-check': paired.field.control === 'boolean' }"
                :data-prop="paired.field.name"
                :data-authored="paired.field.authored"
                :data-linked="isPropertyBound(paired.field) || undefined"
                :title="paired.field.readonlyReason ?? undefined"
                @mouseenter="onHover(paired.field.name)"
                @mouseleave="onHover(null)"
              >
                <PropertyField
                  :field="paired.field"
                  :text-direction="textDirection"
                  :resolved-value="resolved(paired.field)"
                  :held-value="heldFor(paired.field)"
                  :editable="editable(paired.field)"
                  :swatches="swatches"
                  :candidates="candidatesFor(paired.field)"
                  :variables="variablesFor(paired.field)"
                  :component-name="componentName"
                  :tokens="tokens"
                  :token-index="tokenIndex"
                  @preview="onPreview"
                  @commit="onCommit"
                  @link="onLink"
                  @unlink="onUnlink"
                  @create="onCreate"
                  @edit="onEditDeclaration"
                  @pick-variable="onPickVariable"
                  @detach="onDetach"
                />
              </div>
            </template>
            <div v-if="group.id === 'layout-spacing' && hasAutoLayout" class="field field-padding">
              <span class="field-caption">Padding</span>
              <PaddingField
                :values="paddingValues"
                :editable="writable !== false"
                :token-source="tokenSource"
                @bind="onBindVariables"
                @detach="onDetachVariables"
                @preview="onMultiPreview"
                @commit="onMultiCommit"
                @hover="onHover"
              />
            </div>
            <div v-if="group.id === 'appearance-main' && showCorners" class="field field-corner">
              <span class="field-caption">Corner radius</span>
              <CornerField
                :corners="cornerValues"
                :per-corner="hasPerCorner"
                :smoothing="numberOf('cornerSmoothing')"
                :editable="writable !== false"
                :token-source="tokenSource"
                @bind="onBindVariables"
                @detach="onDetachVariables"
                @preview="onMultiPreview"
                @commit="onMultiCommit"
                @hover="onHover"
              />
            </div>
          </InspectorGroup>
        </PropertySectionContent>
      </PropertySectionRoot>

      <!--
        One dialog for the pane, not one per row: only one field can be asking
        at a time, and the submit is the pane's to make either way.
      -->
      <PropertyDialog
        v-if="creating"
        :key="creating.prop"
        mode="create"
        :type="creating.type"
        :value="creating.value"
        @submit="onCreateSubmit"
        @close="creating = null"
      />

      <PropertyDialog
        v-if="editing"
        :key="editing.from"
        mode="edit"
        :type="editing.type"
        :name="editing.from"
        :value="editing.value"
        @submit="onEditSubmit"
        @close="editing = null"
      />

      <InspectorGroup
        v-if="unmapped.length"
        :group="{
          id: 'additional-properties',
          label: 'Additional properties',
          advanced: true,
          fields: unmapped.map((field) => ({ field, pairedWith: null })),
        }"
      >
        <div
          v-for="field in unmapped"
          :key="field.name"
          class="field"
          :data-prop="field.name"
          :data-authored="field.authored"
          @mouseenter="onHover(field.name)"
          @mouseleave="onHover(null)"
        >
          <PropertyField
            :field="field"
            :resolved-value="null"
            :held-value="null"
            :editable="editable(field)"
            :swatches="swatches"
            :tokens="tokens"
            :token-index="tokenIndex"
            @preview="onPreview"
            @commit="onCommit"
            @detach="onDetach"
          />
        </div>
      </InspectorGroup>
      <!--
        Export closes the panel, after every section that styles the layer —
        the last thing you do to a layer is take it away as a file. It is not
        a `PropGroup`: it reads no property, writes no patch, and holds no
        value the document could carry.
      -->
      <PropertySectionRoot
        v-model:open="exportOpen"
        class="section"
        aria-label="Export"
        data-export-section
      >
        <PropertySectionHeader v-slot="{ actions, stateAttrs }" class="section-head">
          <button
            type="button"
            class="section-toggle"
            v-bind="stateAttrs"
            :aria-expanded="exportOpen"
            @click="actions.toggle()"
          >
            <PropertySectionTitle class="section-title">Export</PropertySectionTitle>
            <span class="chevron" aria-hidden="true">›</span>
          </button>
        </PropertySectionHeader>
        <PropertySectionContent class="section-body">
          <!--
            The whole vocabulary on one row rather than behind a menu: three
            formats fit, and a menu that has to be opened to be read hides how
            few choices there are.
          -->
          <div class="format-pills" role="radiogroup" aria-label="Export format">
            <button
              v-for="format in EXPORT_FORMATS"
              :key="format"
              type="button"
              role="radio"
              class="format-pill"
              :data-export-format="format"
              :aria-checked="exportFormat === format"
              @click="exportFormat = format"
            >
              {{ format }}
            </button>
          </div>

          <!--
            Scale and the pixels it lands on, side by side, because one is the
            question and the other is its consequence. Under SVG both go quiet
            rather than disappearing: a section that changed height on every
            format click would move the button out from under the cursor.
          -->
          <div class="export-row">
            <label class="export-field">
              <span>Scale</span>
              <input
                type="text"
                inputmode="decimal"
                data-export-scale
                :value="exportScale"
                :disabled="!scaleApplies"
                @input="onExportScale"
              />
            </label>
            <span class="export-field">
              <span>Pixels</span>
              <span class="export-pixels" data-export-pixels>
                {{ exportPixels ? `${exportPixels.width} × ${exportPixels.height}` : '—' }}
              </span>
            </span>
          </div>

          <!--
            The button names the file, so the answer is legible before it is
            given. Enabled while the file is read-only: every other control in
            this panel writes, and this one only reads.
          -->
          <button
            type="button"
            class="export-run"
            data-export-run
            :disabled="!canExport"
            @click="onExport"
          >
            Export {{ exportFileName }}
          </button>
        </PropertySectionContent>
      </PropertySectionRoot>
    </section>
  </aside>
</template>

<style scoped>
.root-size-setting {
  padding: var(--pad);
}
.root-size-input {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--raised);
  border: 1px solid transparent;
  border-radius: var(--radius-lg);
  padding: 2px 6px;
  color: var(--text-dim);
}
.root-size-input:focus-within {
  border-color: var(--accent);
}
.root-size-input input {
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  background: none;
  border: none;
  color: var(--text);
  font: inherit;
  outline: none;
}

.properties {
  overflow: auto;
  min-width: 0;
  padding: 0 var(--section-pad);
  background: var(--panel);
  scrollbar-width: thin;
  scrollbar-color: var(--line) transparent;
  --field-h: 32px;
  --ui-size: 12px;
  --ui-size-sm: 11px;
  border-left: 1px solid var(--line);
  font-family: var(--ui-font);
  font-size: var(--ui-size);
}
.inspector-header {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: 0 calc(-1 * var(--section-pad));
  padding: 12px var(--section-pad);
  background: var(--panel);
  border-bottom: 1px solid var(--line);
}
.inspector-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h2 {
  font-size: 12px;
  font-weight: 600;
  margin: 0;
}
.read-only-badge {
  color: var(--warn);
  font-size: var(--ui-size-sm);
}
.note {
  color: var(--text-faint);
  font-size: var(--ui-size);
  line-height: 1.5;
  margin: 12px 0;
}
.note.warn {
  color: var(--warn);
}
.section-link {
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 0;
}

.instance-swap-row {
  position: relative;
  display: flex;
  gap: var(--gap-sm) 10px;
  align-items: center;
  padding: 2px 0 var(--gap-sm);
}
.instance-swap-row > label {
  width: 90px;
  color: var(--text-faint);
}
/* Linked, the pill takes the row — the same rule the field rows follow, and
   for the same reason: a property name squeezed beside a label truncates. */
.instance-swap-row[data-linked] > label {
  display: none;
}
.swap-name {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border-radius: var(--radius);
  background: var(--raised);
  line-height: var(--field-h);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.editor {
  /* Anchors the create dialog, which is absolutely positioned. */
  position: relative;
  margin-bottom: 8px;
}
.section {
  /* Full-bleed separators: the rule runs edge to edge of the pane, UI3's
     section boundary, so the margins undo the pane's own padding. */
  margin: 0 calc(-1 * var(--section-pad));
  padding: 0 var(--section-pad);
  border-bottom: 1px solid var(--line);
}
.section-head {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
}
.section-title {
  font-size: var(--ui-size);
  font-weight: 600;
  color: var(--text);
}
/* One box for every header icon: 24px hit target, 12px glyph, quiet at
   rest, a raised pill on hover — Figma's header cluster buttons. */
.cluster-btn {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--row-h);
  height: var(--row-h);
  padding: 0;
  border: 0;
  border-radius: var(--radius);
  background: none;
  color: var(--text-dim);
  cursor: pointer;
}
.cluster-btn:hover:not(:disabled) {
  background: var(--raised);
  color: var(--text);
}
.cluster-btn:disabled {
  opacity: 0.5;
  cursor: default;
}
.section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
}
.chevron {
  color: var(--text-faint);
  font-size: var(--ui-size);
  transform: rotate(90deg);
  transition: transform 0.1s;
}
.section-toggle[data-state='closed'] .chevron {
  transform: rotate(0deg);
}
.section-body {
  padding: 0 0 12px;
}
.field {
  /* Anchor for the popup, which is absolutely positioned. */
  position: relative;
  display: block;
  min-width: 0;
  padding: 5px 0;
}
/* `:deep`, because `PropertyField` has a fragment root: Vue gives a child's
   root element the parent's scope id only when there is exactly one, so a
   plain selector never matches this label. */
.field[data-linked] :deep(label) {
  display: none;
}
.pair-captions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap);
  margin-bottom: 4px;
}
.pair-captions .field-caption {
  margin-bottom: 0;
}
.field-caption {
  display: block;
  color: var(--text-dim);
}
.span-caption {
  grid-column: 1 / -1;
}
.pair-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--gap);
  align-items: start;
}
.field-cell {
  position: relative;
  min-width: 0;
}
:deep([data-inspector-group='layout-spacing']) {
  display: grid;
  grid-template-columns: 82px minmax(0, 1fr);
  column-gap: 12px;
  align-items: start;
}
:deep([data-inspector-group='layout-spacing']) > .field-align {
  grid-column: 1;
  grid-row: 1;
}
:deep([data-inspector-group='layout-spacing']) > :is(.field-padding, .field-pair) {
  grid-column: 1 / -1;
}
:deep([data-inspector-group='layout-spacing'])
  > .field:not(.field-align):not(.field-padding):not(.field-pair) {
  grid-column: 2;
}
/*
 * Text options are long — HORIZONTAL does not fit beside a label in a 240px
 * pane — so a segmented control takes the full row beneath its label, the
 * way Figma gives alignment rows their own line when they need it.
 */
.field > :deep(.enum-segmented) {
  grid-column: 1 / -1;
}
/*
 * The rebuilt rows own their whole width: each is one control standing for
 * several props, so the label column that names a single prop has nothing to
 * say and would only steal the space the control needs.
 */
/* Dimensions states the same shape in `DimensionsField`, which owns its own
   caption and therefore its own row rhythm. */
.field-align,
.field-padding,
.field-corner {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap-sm) var(--gap);
  align-items: start;
}
.field-align > *,
.field-padding > *,
.field-corner > * {
  grid-column: 1 / -1;
}
.field-align {
  justify-items: stretch;
  padding: var(--gap-sm) 0;
}
.section-eye[aria-pressed='true'] {
  color: var(--accent);
}
.field-check {
  display: flex;
  align-items: center;
  gap: var(--gap);
}
/* Structured editors own their label and their layout — full row. */
.field > :deep(.structured) {
  grid-column: 1 / -1;
}
.node-head {
  display: flex;
  gap: var(--gap);
  align-items: center;
  flex-wrap: wrap;
  padding-top: 12px;
}
.element {
  order: 2;
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
}
.name {
  color: var(--text);
  font-weight: 700;
}
/*
 * A maturity chip, coloured by what the status means rather than by a palette
 * of its own: stable is the same green a healthy connection uses, draft the
 * same amber as a warning, deprecated the same red as a rejection.
 */
.meta {
  padding: 0 var(--gap-sm);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  color: var(--text-dim);
  font-size: var(--ui-size-sm);
}
.meta[data-meta='status'][data-value='stable'] {
  border-color: var(--ok);
  color: var(--ok);
}
.meta[data-meta='status'][data-value='draft'] {
  border-color: var(--warn);
  color: var(--warn);
}
.meta[data-meta='status'][data-value='deprecated'] {
  border-color: var(--danger);
  color: var(--danger);
}

/* One segmented control, the width of the section: three formats and no room
   for a fourth, which is the point. */
.format-pills {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  padding: 1px;
  border-radius: var(--radius);
  background: var(--raised);
  margin: 5px 0;
}
.format-pill {
  height: calc(var(--field-h) - 4px);
  border: 0;
  border-radius: calc(var(--radius) - 1px);
  background: none;
  color: var(--text-dim);
  font: inherit;
  cursor: pointer;
}
.format-pill:hover {
  color: var(--text);
}
.format-pill[aria-checked='true'] {
  background: var(--accent);
  color: var(--text);
}
.export-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--gap);
  min-width: 0;
  padding: 5px 0;
}
.export-field {
  display: flex;
  align-items: center;
  gap: var(--gap-sm);
  min-width: 0;
  color: var(--text-faint);
}
.export-field input {
  width: 100%;
  min-width: 0;
  height: var(--field-h);
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
}
.export-field input:focus {
  border-color: var(--accent);
  outline: none;
}
.export-field input:disabled {
  opacity: 0.4;
}
/* The consequence of the scale, not a control — it reads as a value, and it
   is never focusable, because there is nothing here to change. */
.export-pixels {
  flex: 1;
  min-width: 0;
  height: var(--field-h);
  line-height: var(--field-h);
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.export-row:has(input:disabled) .export-pixels {
  opacity: 0.4;
}
.export-run {
  display: block;
  width: 100%;
  height: var(--field-h);
  margin-top: 5px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--raised);
  color: var(--text);
  font: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
.export-run:hover:not(:disabled) {
  border-color: var(--accent);
}
.export-run:disabled {
  opacity: 0.5;
  cursor: default;
}

.node-actions {
  padding: 0 var(--section-pad) var(--pad);
}

.node-actions button {
  width: 100%;
  height: var(--field-h);
  font: inherit;
  color: var(--text);
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
}

.node-actions button:hover:not(:disabled) {
  border-color: var(--accent);
}

.node-actions button:disabled {
  color: var(--text-faint);
  cursor: default;
}

.fill-actions {
  padding: 0 var(--section-pad) var(--pad);
  border-bottom: 1px solid var(--line);
}

.fill-buttons {
  display: flex;
  gap: var(--gap-sm);
}

.fill-buttons button {
  flex: 1;
  height: var(--field-h);
  font: inherit;
  color: var(--text);
  background: var(--raised);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
}

.fill-buttons button:hover:not(:disabled) {
  border-color: var(--accent);
}

.fill-buttons button:disabled {
  color: var(--text-faint);
  cursor: default;
}
</style>
