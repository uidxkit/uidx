import type { ContractSpec, JsonValue, UidxNode } from '@uidx/format'
import {
  modelSamples,
  sampleCount,
  specBindings,
  STATE_AXIS,
  stateKind,
  styleTarget,
} from '@uidx/schema/design-system'
import { cssDeclarations, cssRule, type CssKind } from './css.js'
import {
  attributeName,
  boundPath,
  boundProp,
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

/** The stylesheet: the base tree, then the styles table as state and attribute rules. */
export function emitCss(model: ComponentModel, ctx?: HtmlContext): string {
  const root = model.tag ?? `.${model.stem}`
  const rules: string[] = [
    `/* ${model.name} — generated by uidx codegen; edit the .uidx file instead. */\n`,
  ]
  const declared = new Set<string>()

  const walk = (node: UidxNode, parentSelector = root): void => {
    if (node.element === 'Instance') return
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
    const declarations = cssDeclarations(attrValues(node), kindOf(node))
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
    if (Object.keys(declarations).length) {
      rules.push(cssRule(selector, declarations))
      declared.add(selector)
    }
    for (const child of node.children) walk(child, selector)
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
    for (const [part, props] of Object.entries(row.values)) {
      const info = part === 'root' ? undefined : model.parts.find((entry) => entry.name === part)
      // A row targets the root, a part, or one of the design's own nodes by name.
      const target = part === 'root' ? model.node : (info?.node ?? styleTarget(model.node, part))
      const selector = target
        ? selectorFor(model, target, scoped)
        : info
          ? partSelector(scoped, info)
          : `${scoped} [data-node="${part}"]`
      const declarations = cssDeclarations(props, target ? kindOf(target) : 'container')
      // A slot shown by a row keeps the display its base rule gives it.
      if (target?.element === 'Slot' && declarations.display === 'inline-flex')
        declarations.display = 'contents'
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
      return markup(target, target.node, ctx, passed, depth, index, filled)
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
        return markup(model, model.composes, ctx, samples, depth, index, fills)
      if (node === model.node) {
        const tag = model.tag ?? 'div'
        const attrs = model.tag ? hostAttributes(model) : ` class="${model.stem}"`
        return [`${pad}<${tag}${attrs}>`, ...children(), `${pad}</${tag}>`]
      }
      const [open, close] = (info && partTags(info)) ?? [`<div data-node="${node.name}">`, '</div>']
      return [`${pad}${open}`, ...children(), `${pad}${close}`]
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
