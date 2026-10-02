import {
  DEFAULT_STATE,
  toAlias,
  type ContractSpec,
  type JsonValue,
  type UidxNode,
} from '@uidx/format'
import { instanceFills } from '@uidx/schema'
import {
  componentBox,
  INSTANCE_BOX_HOOKS,
  modelSamples,
  sampleCount,
  specBindings,
  STATE_AXIS,
  stateKind,
  styleTarget,
} from '@uidx/schema/design-system'
import {
  boxTargetOf,
  boxValue,
  INSTANCE_BOX_SHORTHANDS,
  instanceRole,
  type BoxTarget,
} from '@uidx/schema/instance-box'
import {
  BOX_HOOK_RESETS,
  boxFallbacks,
  cssDeclarations,
  cssLength,
  cssNumber,
  cssPaint,
  cssRule,
  textColor,
  withBoxHooks,
  type CssKind,
} from './css.js'
import {
  attributeName,
  boundPath,
  boundProp,
  parentOf,
  repeatFor,
  type ComponentModel,
  type PartInfo,
  vectorPaint,
} from './model.js'

/**
 * The HTML/CSS target (ADR 0017 §3): one stylesheet per component, keyed by
 * the headless root's attributes and states, and one markup fragment
 * showing the anatomy with sample content.
 */

export interface HtmlContext {
  /** Every component of the document set, by name — for instances and repeats. */
  components: Map<string, ComponentModel>
}

/** How a state of the contract is selected in CSS. */
export function stateSelector(
  state: string,
  contract?: ContractSpec,
  model?: ComponentModel,
): string {
  switch (stateKind(state, contract)) {
    case 'interaction':
      if (state === 'focus') return model?.shadow ? ':focus-within' : ':focus-visible'
      return state === 'hover' ? ':hover' : ':active'
    // The list the consumer passed is empty: the React target sets it.
    case 'collection':
      return '[data-empty]'
    // A state the element produces itself: `:state()` through ElementInternals
    // unless the library spells it otherwise.
    case 'declared':
      switch (model?.profile.customStates) {
        case 'data-attribute':
          return `[data-${state}]`
        case 'class':
          return `.${state}`
        default:
          return `:state(${state})`
      }
    // A visual boolean prop, reflected the way the library reflects props —
    // and the fallback for a name the contract cannot place, which the audit
    // has reported.
    default:
      return model ? propSelector(model, state) : `[${state}]`
  }
}

/** A prop's selector the way the library reflects it: `[variant="a"]`, `[data-variant="a"]`, `.variant-a`. */
export function propSelector(model: ComponentModel, prop: string, value?: string): string {
  const attr = attributeName(model, prop)
  switch (model.profile.props) {
    case 'data-attribute':
      return value === undefined ? `[data-${attr}]` : `[data-${attr}="${value}"]`
    case 'class':
      return value === undefined ? `.${attr}` : `.${attr}-${value}`
    default:
      return value === undefined ? `[${attr}]` : `[${attr}="${value}"]`
  }
}

/** A part's selector below the root, by the kind the library gives it. */
function partSelector(root: string, info: PartInfo): string {
  switch (info.kind) {
    case 'shadow':
      return `${root}::part(${info.libraryName})`
    case 'data-part':
      return `${root} [data-part="${info.libraryName}"]`
    default:
      return `${root} ${info.tag}`
  }
}

/** The open and close tags a part's node renders as, or null for a shadow part. */
function partTags(info: PartInfo): [string, string] | null {
  switch (info.kind) {
    case 'shadow':
      return null
    case 'data-part':
      return [`<span data-part="${info.libraryName}">`, '</span>']
    default:
      return [`<${info.tag}>`, `</${info.tag}>`]
  }
}

const VOID_ATTRS = new Set([
  'name',
  'part',
  'characters',
  'vectorPaths',
  'implements',
  'slot',
  'component',
  'props',
  'overrides',
  'status',
  'version',
  'modes',
  'rootFontSize',
])

function attrValues(node: UidxNode): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {}
  for (const [name, attr] of Object.entries(node.attrs)) {
    if (VOID_ATTRS.has(name)) continue
    out[name] = attr.value
  }
  return out
}

/** A text's fill is its colour; so is a vector's, whose paths use `currentColor`. */
function kindOf(node: UidxNode): CssKind {
  return node.element === 'Text' ? 'text' : node.element === 'Vector' ? 'vector' : 'container'
}

/** The selector for a node inside the component, given the root's selector. */
function selectorFor(model: ComponentModel, node: UidxNode, root: string): string {
  if (node === model.node) return root
  const part = model.partOf.get(node)
  if (part !== undefined) {
    const info = model.parts.find((entry) => entry.name === part)!
    return partSelector(root, info)
  }
  if (node.element === 'Slot') return `${root} [data-slot="${node.name}"]`
  return `${root} [data-node="${node.name}"]`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Declarations about taking part in a parent's flow, rather than about the box itself. */
const PARTICIPATION = ['align-self', 'flex-grow'] as const

/**
 * How the rows of a repeating slot sit in the flow, read the way the canvas
 * draws them. A slot stretched across its parent places each row by its own
 * cross-axis alignment, so every row — the default or one a consumer injects
 * — takes that; the default row then keeps what its instance says for itself
 * (stretched across the list), on its component's own selector so it wins.
 */
function rowRules(slot: UidxNode, parent: string, ctx?: HtmlContext): string[] {
  const out: string[] = []
  if (slot.attrs.layoutAlign?.value === 'STRETCH') {
    const align = slot.attrs.counterAxisAlignItems?.value
    const self =
      align === 'CENTER'
        ? 'center'
        : align === 'MAX'
          ? 'flex-end'
          : align === 'STRETCH'
            ? 'stretch'
            : 'flex-start'
    out.push(cssRule(`${parent} > *`, { 'align-self': self }))
  }
  const only = slot.children.length === 1 ? slot.children[0]! : null
  const name = only?.element === 'Instance' ? only.attrs.component?.value : undefined
  const definition = typeof name === 'string' ? ctx?.components.get(name) : undefined
  if (only && definition) {
    const all = cssDeclarations(attrValues(only), 'container')
    const own = Object.fromEntries(
      PARTICIPATION.filter((prop) => all[prop] !== undefined).map((prop) => [prop, all[prop]!]),
    )
    if (Object.keys(own).length)
      out.push(cssRule(`${parent} > ${definition.tag ?? `.${definition.stem}`}`, own))
  }
  return out
}

/**
 * Where a use's outer box lands in the component (ADR 0018 §2), by the rule
 * the canvas uses. A component with a styles table is drawn as its derived
 * variant, whose `root` is the component's own element here, as its rows'
 * `root:` is — and that root carries the component's own attributes, so the
 * rule reads the same off the component: its own element, the frame or
 * instance it wraps, or the one a frame that only wraps it holds.
 */
export function boxOf(model: ComponentModel): BoxTarget {
  return boxTargetOf(model.node)
}

/** The node whose rule reads the box hooks, or undefined when an instance it holds takes them. */
function boxNodeOf(model: ComponentModel): UidxNode | undefined {
  const box = boxOf(model)
  return box.kind === 'self' ? model.node : box.kind === 'frame' ? box.node : undefined
}

/**
 * A row keyed only by visual enums, or by `state="default"`: the component's
 * resting look for that combination, which a use's box lies over. A row keyed
 * by any other state sits above the use and stays literal (ADR 0018 §3) — the
 * same split the canvas makes with its `stateRow` stamp.
 */
function isResting(keys: Readonly<Record<string, string>>): boolean {
  const state = keys[STATE_AXIS]
  return state === undefined || state === DEFAULT_STATE
}

const hasBorderWidth = (declarations: Record<string, string> | undefined): boolean =>
  Object.keys(declarations ?? {}).some((prop) => /^border(-\w+)?-width$/.test(prop))

/** The stylesheet: the base tree, then the styles table as state and attribute rules. */
export function emitCss(model: ComponentModel, ctx?: HtmlContext): string {
  const root = model.tag ?? `.${model.stem}`
  const rules: string[] = [
    `/* ${model.name} — generated by uidx codegen; edit the .uidx file instead. */\n`,
  ]
  const declared = new Set<string>()
  // ADR 0018 §6: the box's resting rules read the `--uidx-*` hooks. A shadow
  // host is the library's to style, so there only what the design states is
  // read — a fallback for everything else would override the library's own.
  const box = boxNodeOf(model)
  const complete = !model.shadow
  // Whether a use's padding insets anything, as the canvas draws the box and
  // the contract states it: a styles table's root is a frame there, which
  // lays out only when it says so, however bare the component.
  const padded = box !== undefined && componentBox(model.node).laysOut === true
  const based = new Map<UidxNode, Record<string, string>>()

  const walk = (node: UidxNode, parentSelector = root): void => {
    if (node.element === 'Instance') return fillsOf(node)
    // A composition has no element of its own to style; its instance's
    // stylesheet is the one that applies.
    if (node === model.node && model.composes) return
    // A repeating slot renders each row with no wrapper (ADR 0017 §2), so a
    // rule on `[data-slot]` matched nothing. How a row sits in its parent's
    // flow — stretched across a list, growing — goes on the rows themselves,
    // whoever supplies them: the default item or one a consumer injects.
    if (node.element === 'Slot' && repeatFor(model, node)) {
      rules.push(...rowRules(node, parentSelector, ctx))
      return
    }
    const selector = selectorFor(model, node, root)
    const values = attrValues(node)
    let declarations = cssDeclarations(values, kindOf(node))
    if (node === model.node && !declarations.display && node.attrs.layoutMode === undefined) {
      // A component is a frame (ADR 0008): its children stack unless it says otherwise.
      declarations.display = 'inline-flex'
      declarations['flex-direction'] = 'column'
    }
    if (node.element === 'Slot' && !declarations.display) declarations.display = 'contents'
    // An ellipse is its box, rounded all the way: drawn round on the canvas,
    // it rendered as a square in code.
    if (node.element === 'Ellipse' && !declarations['border-radius'])
      declarations['border-radius'] = '50%'
    if (node === box)
      declarations = withBoxHooks(declarations, complete ? boxFallbacks(values, padded) : undefined)
    else if (node.element === 'Text' && (declarations.color !== undefined || complete))
      declarations.color = textColor(declarations.color)
    if (node === model.node) Object.assign(declarations, BOX_HOOK_RESETS)
    based.set(node, declarations)
    if (Object.keys(declarations).length) {
      rules.push(cssRule(selector, declarations))
      declared.add(selector)
    }
    for (const child of node.children) walk(child, selector)
  }

  /*
   * What this component puts in the slots of an instance it holds is its own
   * content, which the instance's stylesheet never sees (ADR 0007 §2): it is
   * styled here, where it is written. A text keeps fills it states as a
   * literal colour, which no use's colour reaches, and one that states none
   * takes the nearest use's — explicit beats inherited (ADR 0018 §4). An
   * instance there has its own stylesheet; what it is filled with is
   * still this component's.
   */
  const fillsOf = (instance: UidxNode): void => {
    for (const slot of instance.children)
      if (slot.element === 'Slot') for (const child of slot.children) fill(child)
  }
  const fill = (node: UidxNode): void => {
    if (node.element === 'Instance') return fillsOf(node)
    const declarations = cssDeclarations(attrValues(node), kindOf(node))
    if (node.element === 'Text' && declarations.color === undefined)
      declarations.color = textColor(undefined)
    const selector = selectorFor(model, node, root)
    if (Object.keys(declarations).length && !declared.has(selector)) {
      rules.push(cssRule(selector, declarations))
      declared.add(selector)
    }
    for (const child of node.children) fill(child)
  }
  walk(model.node)

  for (const row of model.spec?.styles ?? []) {
    let scoped = root
    for (const [axis, value] of Object.entries(row.keys)) {
      scoped +=
        axis === STATE_AXIS
          ? stateSelector(value, model.contract, model)
          : propSelector(model, axis, value)
    }
    const resting = isResting(row.keys)
    for (const [part, props] of Object.entries(row.values)) {
      const info = part === 'root' ? undefined : model.parts.find((entry) => entry.name === part)
      // A row targets the root, a part, or one of the design's own nodes by name.
      const target = part === 'root' ? model.node : (info?.node ?? styleTarget(model.node, part))
      const selector = target
        ? selectorFor(model, target, scoped)
        : info
          ? partSelector(scoped, info)
          : `${scoped} [data-node="${part}"]`
      let declarations = cssDeclarations(props, target ? kindOf(target) : 'container', 'row')
      // A slot shown by a row keeps the display its base rule gives it.
      if (target?.element === 'Slot' && declarations.display === 'inline-flex')
        declarations.display = 'contents'
      // A row that strokes a node its base never stroked: the stroke draws at
      // Figma's weight of 1, which the row's colour alone would not say.
      if (
        declarations['border-color'] !== undefined &&
        !hasBorderWidth(declarations) &&
        !hasBorderWidth(target ? based.get(target) : undefined)
      )
        declarations['border-width'] = '1px'
      if (resting && target !== undefined && target === box)
        declarations = withBoxHooks(declarations)
      else if (resting && target?.element === 'Text' && declarations.color !== undefined)
        declarations.color = textColor(declarations.color)
      rules.push(cssRule(selector, declarations))
    }
  }
  return rules.filter(Boolean).join('\n')
}

/** Sample text for a node whose `characters` binds a prop or a model field. */
function sampleText(
  model: ComponentModel,
  node: UidxNode,
  samples: Map<string, JsonValue>,
): string {
  const characters = node.attrs.characters?.value
  if (typeof characters !== 'string') return ''
  const prop = boundProp(model, characters)
  if (prop) {
    const value = samples.get(prop.name) ?? prop.default
    if (value !== undefined && value !== null) return String(value)
    // No sample and no default: the prop's name, as a person would write it.
    return prop.name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
  }
  // A repeat's item binds too: the samples map carries `{as.field}` for the
  // row being rendered, so the path is answered from it either way.
  const path = boundPath(
    model,
    characters,
    model.repeats.map((r) => ({ as: r.as, model: r.model })),
  )
  if (path) {
    const value = samples.get(path.join('.'))
    return value === undefined || value === null ? '' : String(value)
  }
  return characters.startsWith('{') ? '' : characters
}

/** An instance attribute's value as the hook takes it, or null when CSS cannot say it. */
function hookValue(prop: string, value: JsonValue): string | null {
  switch (prop) {
    // `[]` is the use's explicit "none" (ADR 0018 §5). A stroke's none is its
    // style, below.
    case 'fills':
    case 'textFills':
      return Array.isArray(value) && value.length === 0 ? 'transparent' : cssPaint(value)
    case 'strokes':
      return cssPaint(value)
    case 'opacity':
      return cssNumber(value)
    case 'effects':
      return (
        cssDeclarations({ effects: value }, 'container')['box-shadow'] ??
        (Array.isArray(value) ? 'none' : null)
      )
    case 'dashPattern':
      return null
    default:
      return cssLength(value)
  }
}

/**
 * The `style` a nested instance carries (ADR 0018 §6): the hooks for the box
 * and text colour it states, and the size it fixes.
 *
 * Each value is bound as the canvas binds it (`boxValue`), except that a
 * token stays a token, written as its variable: a component-property or item
 * binding is dropped, so the component's own value shows. Placement,
 * structure and the locked inside are never written; neither is
 * `strokeAlign` or `cornerSmoothing`, which CSS cannot say.
 *
 * A stroke the use states comes with its style, since a component with no
 * stroke of its own reads `none`: dashed when the use's dashes — or the
 * component's, which a use's `strokes` keeps — say so. The weight is the
 * hooks' own business: a use that states none takes the component's, or 1.
 *
 * The size follows the resize decision: a stated width or height is Fixed,
 * unless the instance asks its parent to fill that axis (`instanceFills`).
 */
export function instanceInlineStyle(
  instance: UidxNode,
  target: ComponentModel,
  parentLayout: JsonValue | undefined,
): Record<string, string> {
  const out: Record<string, string> = {}
  const warnings: string[] = []
  const bound = (prop: string) => boxValue(instance, prop, toAlias, warnings)
  for (const prop of Object.keys(instance.attrs)) {
    const role = instanceRole(prop)
    const hook = INSTANCE_BOX_HOOKS[prop]
    if ((role !== 'box' && role !== 'cascade') || hook === undefined) continue
    const value = bound(prop)
    if (value === undefined) continue
    const text = hookValue(prop, value)
    if (text !== null) out[hook] = text
    if (prop === 'strokes' || prop === 'dashPattern') {
      const strokes = prop === 'strokes' ? value : bound('strokes')
      const dashes = bound('dashPattern') ?? boxNodeOf(target)?.attrs.dashPattern?.value
      out[INSTANCE_BOX_HOOKS.dashPattern!] =
        Array.isArray(strokes) && strokes.length === 0
          ? 'none'
          : Array.isArray(dashes) && dashes.length > 0
            ? 'dashed'
            : 'solid'
    }
  }
  const layout =
    typeof parentLayout === 'string'
      ? (parentLayout as Parameters<typeof instanceFills>[1])
      : undefined
  const filled = instanceFills(instance, layout)
  for (const dimension of ['width', 'height'] as const) {
    const value = instance.attrs[dimension]?.value
    const length = value === undefined || filled[dimension] ? null : cssLength(value)
    if (length !== null) out[dimension] = length
  }
  return out
}

/**
 * The style a use passes to the instance its component holds, laid over what
 * the definition wrote on it: the use wins, as React's `style` does, and a
 * shorthand it states drops the definition's longhands (ADR 0018 §2, §5).
 */
function laidOver(
  own: Record<string, string>,
  use: Record<string, string>,
): Record<string, string> {
  const out = { ...own }
  for (const [shorthand, longhands] of Object.entries(INSTANCE_BOX_SHORTHANDS)) {
    if (!(INSTANCE_BOX_HOOKS[shorthand]! in use)) continue
    for (const longhand of longhands) delete out[INSTANCE_BOX_HOOKS[longhand]!]
  }
  return Object.assign(out, use)
}

/** ` style="…"`, or nothing for no declarations. */
function styleAttribute(style: Record<string, string> | undefined): string {
  const entries = Object.entries(style ?? {})
  if (entries.length === 0) return ''
  return ` style="${escapeHtml(entries.map(([prop, value]) => `${prop}: ${value}`).join('; '))}"`
}

/** Elements mid-expansion, so a row renders its own markup rather than repeating again. */
const repeating = new WeakSet<UidxNode>()

function markup(
  model: ComponentModel,
  node: UidxNode,
  ctx: HtmlContext,
  samples: Map<string, JsonValue>,
  depth: number,
  /** Which sample an instance inside a repeat shows (ADR 0015 §2). */
  index = 0,
  /** What the consuming page put in this component's slots (ADR 0007 §2), already rendered. */
  fills: ReadonlyMap<string, string[]> = new Map(),
  /**
   * The hooks and size the consuming page's instance sets (ADR 0018 §6), for
   * the element that takes them: this component's root, or — for the
   * instance a composition holds — that instance, over what it states.
   */
  rootStyle?: Record<string, string>,
): string[] {
  const pad = '  '.repeat(depth)
  const part = model.partOf.get(node)
  const info = part === undefined ? undefined : model.parts.find((entry) => entry.name === part)
  // A shadow part is the library's to draw: styled from outside through
  // `::part()`, never filled. Nothing to emit here; conformance reports what
  // the design put under it.
  // What a slot inside it receives is still the page's to give: slot content
  // lives in the light DOM whatever the shadow tree around it looks like.
  if (info?.kind === 'shadow')
    return slotsWithin(node, (slot) => markup(model, slot, ctx, samples, depth, index, fills))
  // ADR 0017 §2: an element with `repeat` is rendered once per sample of its
  // list's model, the n-th row with `{as.field}` bound to the n-th samples.
  // A repeating slot renders its content per row with no wrapper, so a
  // headless list holds its items directly.
  const repeat = repeatFor(model, node)
  if (repeat && !repeating.has(node)) {
    const count = sampleCount(repeat.model)
    const lines: string[] = []
    repeating.add(node)
    try {
      for (let n = 0; n < count; n++) {
        const rowSamples = new Map(samples)
        if (repeat.model)
          for (const [key, value] of modelSamples(
            repeat.as,
            repeat.model,
            n,
            model.spec,
            model.models,
          ))
            rowSamples.set(key, value)
        if (node.element === 'Slot') {
          for (const child of node.children)
            lines.push(...markup(model, child, ctx, rowSamples, depth, n, fills))
        } else lines.push(...markup(model, node, ctx, rowSamples, depth, n, fills))
      }
    } finally {
      repeating.delete(node)
    }
    return lines
  }
  const children = (): string[] =>
    node.children.flatMap((child) => markup(model, child, ctx, samples, depth + 1, index, fills))

  switch (node.element) {
    case 'Instance': {
      const name = node.attrs.component?.value
      const target = typeof name === 'string' ? ctx.components.get(name) : undefined
      // The component's own anatomy with its samples at this index — the
      // markup a page would hold, not a bare tag — and this page's fills in
      // its slots, rendered here, where their bindings mean this page's.
      if (!target) return [`${pad}<div data-instance="${escapeHtml(String(name ?? ''))}"></div>`]
      const filled = new Map<string, string[]>()
      for (const fill of node.children) {
        if (fill.element !== 'Slot') continue
        filled.set(
          fill.name,
          fill.children.flatMap((child) =>
            markup(model, child, ctx, samples, depth + 2, index, fills),
          ),
        )
      }
      // What this page passes lies over the target's own samples: a `{label}`
      // is this page's prop, resolved in *this* page's samples (ADR 0017 §3),
      // a literal is a literal.
      const passed = new Map(specBindings(target.spec, index))
      const declared = node.attrs.props?.value
      if (declared && typeof declared === 'object' && !Array.isArray(declared)) {
        for (const [key, value] of Object.entries(declared as Record<string, JsonValue>)) {
          const own = boundProp(model, value)
          const resolved = own ? samples.get(own.name) : value
          if (resolved !== undefined && resolved !== null) passed.set(key, resolved)
        }
      }
      const style = instanceInlineStyle(
        node,
        target,
        parentOf(model, node)?.attrs.layoutMode?.value,
      )
      return markup(
        target,
        target.node,
        ctx,
        passed,
        depth,
        index,
        filled,
        rootStyle ? laidOver(style, rootStyle) : style,
      )
    }
    case 'Slot': {
      const fill = fills.get(node.name)
      // An empty slot of the library's own is the consumer's to fill; its
      // name as placeholder text would land inside the element as content.
      if (!fill && !node.children.length && model.slotted.has(node.name)) return []
      const inner =
        fill ?? (node.children.length ? children() : [`${pad}  ${escapeHtml(node.name)}`])
      const slot = model.slotted.has(node.name) ? ` slot="${node.name}"` : ''
      return [`${pad}<span${slot} data-slot="${node.name}">`, ...inner, `${pad}</span>`]
    }
    case 'Text': {
      const [open, close] = (info && partTags(info)) ?? [
        `<span data-node="${node.name}">`,
        '</span>',
      ]
      return [`${pad}${open}${escapeHtml(sampleText(model, node, samples))}${close}`]
    }
    case 'Vector': {
      const width = typeof node.attrs.width?.value === 'number' ? node.attrs.width.value : 16
      const height = typeof node.attrs.height?.value === 'number' ? node.attrs.height.value : 16
      const paths = Array.isArray(node.attrs.vectorPaths?.value)
        ? (node.attrs.vectorPaths.value as JsonValue[])
        : []
      const d = paths
        .map((entry) =>
          entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, JsonValue>).data
            : undefined,
        )
        .filter((data): data is string => typeof data === 'string')
      const paint = vectorPaint(node)
      const svg = `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">${d.map((data) => `<path d="${escapeHtml(data)}" ${paint} />`).join('')}</svg>`
      const [open, close] = (info && partTags(info)) ?? [
        `<span data-node="${node.name}">`,
        '</span>',
      ]
      return [`${pad}${open}${svg}${close}`]
    }
    default: {
      // Frame, Rectangle, Ellipse — and the component itself.
      if (node === model.node && model.composes)
        return markup(model, model.composes, ctx, samples, depth, index, fills, rootStyle)
      if (node === model.node) {
        const tag = model.tag ?? 'div'
        const attrs = model.tag ? hostAttributes(model) : ` class="${model.stem}"`
        // The box is the one instance this component holds: the use's style
        // goes there. Otherwise it goes on the root, and a wrapped frame that
        // is the box inherits the hooks from it.
        if (boxOf(model).kind === 'instance') {
          const inner = node.children.flatMap((child) =>
            markup(model, child, ctx, samples, depth + 1, index, fills, rootStyle),
          )
          return [`${pad}<${tag}${attrs}>`, ...inner, `${pad}</${tag}>`]
        }
        return [
          `${pad}<${tag}${attrs}${styleAttribute(rootStyle)}>`,
          ...children(),
          `${pad}</${tag}>`,
        ]
      }
      const [open, close] = (info && partTags(info)) ?? [`<div data-node="${node.name}">`, '</div>']
      // A frame that only wraps the instance that is the box: the use's style
      // goes on down to it.
      const inner = rootStyle
        ? node.children.flatMap((child) =>
            markup(model, child, ctx, samples, depth + 1, index, fills, rootStyle),
          )
        : children()
      return [`${pad}${open}`, ...inner, `${pad}${close}`]
    }
  }
}

/** The anatomy as markup with sample content: what a consumer's page holds. */
export function emitHtml(model: ComponentModel, ctx: HtmlContext): string {
  return `<!-- ${model.name} — generated by uidx codegen; edit the .uidx file instead. -->\n${markup(model, model.node, ctx, model.samples, 0).join('\n')}\n`
}

/** The slots below a node, nearest first, each rendered by `render`: what a shadow part passes through. */
export function slotsWithin(node: UidxNode, render: (slot: UidxNode) => string[]): string[] {
  return node.children.flatMap((child) =>
    child.element === 'Slot' ? render(child) : slotsWithin(child, render),
  )
}

/**
 * Sample text the element takes as an attribute, written on it: a library
 * like Shoelace draws `sl-input`'s label and placeholder in its shadow tree
 * from attributes, so the design's words would otherwise never reach it.
 */
export function hostAttributes(model: ComponentModel): string {
  return (model.contract?.props ?? [])
    .flatMap((prop) => {
      const attribute = attributeName(model, prop.name)
      return typeof prop.sample === 'string' && model.elementAttributes.has(attribute)
        ? [` ${attribute}="${escapeHtml(prop.sample)}"`]
        : []
    })
    .join('')
}
