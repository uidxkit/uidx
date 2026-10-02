import {
  aliasTarget,
  CODES,
  diagnostic,
  hasVariants,
  propertyBinding,
  type Diagnostic,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'
import { deriveVariants } from './design-system.js'
import { boxTargetOf, INSTANCE_LOCKED_PROPS, instanceRole, laysOut } from './instance-box.js'

/**
 * What `uidx check` says about an instance's outer box (ADR 0018 §5, §6).
 *
 * The renderer already ignores what an instance cannot change and drops what
 * it cannot bind, so nothing here is an error: the format may lead the tool
 * (§3.3). These are the warnings that tell an author why the file says one
 * thing and every target draws another:
 *
 * - UIDX154, a locked attribute: the component's inside is its own.
 * - UIDX155, a box value that does nothing: padding where the box does not
 *   lay out, `textFills` where nothing draws text, a binding where only a
 *   value or a token goes, or a token collection whose variables would spell
 *   the generated components' `--uidx-*` hooks.
 *
 * Light like the other audits: the parsed tree and the role table, no
 * renderer, so the CLI loads it without CanvasKit.
 */

/** Every component a document set defines, by name — an `<Instance>` is a reference. */
export type ComponentIndex = ReadonlyMap<string, UidxNode>

/** The first definition of each name wins; `uidx check` reports the duplicate elsewhere. */
export function componentIndex(docs: Iterable<UidxDocument>): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of docs) {
    for (const child of doc.tree.children) {
      const name = child.attrs.name?.value
      if (child.element === 'Component' && typeof name === 'string' && !out.has(name))
        out.set(name, child)
    }
  }
  return out
}

const LOCKED: ReadonlySet<string> = new Set(INSTANCE_LOCKED_PROPS)
const PADDING: ReadonlySet<string> = new Set([
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
])

/**
 * The instance-box warnings for one page. `components` is the whole
 * document's, since an instance usually names a component from another page;
 * without it only this page's components answer, and an instance of any
 * other is checked for its locked attributes and bindings alone.
 */
export function auditInstanceBox(doc: UidxDocument, components?: ComponentIndex): Diagnostic[] {
  const out: Diagnostic[] = []
  const warn = (code: string, message: string, loc: { start: number; end: number }) =>
    out.push(diagnostic(doc.source, code, message, loc, 'warning'))
  const look = new Lookup(components ?? componentIndex([doc]))

  const walk = (node: UidxNode): void => {
    if (node.element === 'Instance') auditInstance(node)
    if (node.element === 'Collection') auditCollection(node)
    node.children.forEach(walk)
  }

  const auditInstance = (instance: UidxNode): void => {
    const name = componentName(instance)
    for (const [prop, attr] of Object.entries(instance.attrs)) {
      // An unknown attribute is the unknown-prop lint's (UIDX300), not a
      // locked one: nothing in the vocabulary says what it would have done.
      if (LOCKED.has(prop)) {
        warn(
          CODES.INSTANCE_LOCKED_PROP,
          `${prop} on an instance of ${name} is ignored, since ${name}'s inside is its own; ` +
            'an instance styles its outer box (fills, strokes, cornerRadius, opacity, effects, ' +
            `padding) and textFills, so change ${name} or detach it (ADR 0018)`,
          attr.loc,
        )
        continue
      }
      const role = instanceRole(prop)
      if (role !== 'box' && role !== 'cascade') continue
      const binding = firstBinding(attr.value)
      if (binding !== null) {
        warn(
          CODES.INSTANCE_BOX_HINT,
          `${prop} binds "{${binding}}", but an instance's outer box takes only a value or a ` +
            `token, so the component's own ${prop} shows; a look that varies belongs in a ` +
            'visual prop and its rows (ADR 0018 §5)',
          attr.loc,
        )
      } else if (PADDING.has(prop) && !look.boxLaysOut(instance)) {
        warn(
          CODES.INSTANCE_BOX_HINT,
          `${prop} does nothing here: ${name}'s box does not lay out, so there is no content ` +
            `to pad; give ${name} a layout or remove ${prop} (ADR 0018 §2)`,
          attr.loc,
        )
      } else if (role === 'cascade' && !look.drawsText(instance)) {
        warn(
          CODES.INSTANCE_BOX_HINT,
          `${prop} does nothing here: ${name} draws no text, so there is nothing to colour ` +
            '(ADR 0018 §4)',
          attr.loc,
        )
      }
    }
  }

  // Codegen spells `uidx#fill` as `--uidx-fill` (`cssVariable`), which is
  // the hook every generated component reads for an instance's fill, so a
  // collection that spells into that prefix restyles every instance at once.
  const auditCollection = (collection: UidxNode): void => {
    const spelled = cssName(collection.name)
    if (spelled !== 'uidx' && !spelled.startsWith('uidx-')) return
    const first = collection.children.find((child) => child.element === 'Variable')
    const example = first ? ` (here --${spelled}-${cssName(first.name)})` : ''
    warn(
      CODES.INSTANCE_BOX_HINT,
      `collection "${collection.name}" spells its variables as --uidx-* custom properties` +
        `${example}, which generated components reserve for an instance's outer box ` +
        '(ADR 0018 §6); rename it',
      collection.attrs.name?.loc ?? collection.openTagLoc,
    )
  }

  walk(doc.tree)
  return out
}

/** How a message names what an instance draws: its component, or the binding that picks it. */
function componentName(instance: UidxNode): string {
  const value = instance.attrs.component?.value
  return typeof value === 'string' && value !== '' ? value : 'its component'
}

/** A name as codegen spells it in a custom property (`cssVariable` in `@uidx/codegen`). */
function cssName(name: string): string {
  return name.replace(/[#/]/g, '-').replace(/[^A-Za-z0-9_-]/g, '')
}

/** The first `{name}` binding anywhere in `value`, or null when it binds none. */
function firstBinding(value: JsonValue): string | null {
  const target = aliasTarget(value)
  if (target !== null) return propertyBinding(target)
  if (value === null || typeof value !== 'object') return null
  for (const entry of Array.isArray(value) ? value : Object.values(value)) {
    const found = firstBinding(entry)
    if (found !== null) return found
  }
  return null
}

/**
 * The two questions UIDX155 asks of the component an instance draws, each
 * answered for every variant it might draw.
 *
 * Which variant a use draws can depend on a bound prop (ADR 0017 §2), which
 * the check cannot read, so a hint is given only when no variant would take
 * the value. A component that cannot be found, or is picked by a binding,
 * answers yes: the check cannot see it, and a warning it cannot back is
 * noise. A component that composes itself answers no along the loop, since
 * nothing there is ever drawn.
 */
class Lookup {
  private readonly derived = new Map<UidxNode, UidxNode>()

  constructor(private readonly components: ComponentIndex) {}

  /**
   * Whether the node an instance's box lands on lays out its content (ADR
   * 0018 §2), by the rule the contract states it with (`laysOut`).
   */
  boxLaysOut(instance: UidxNode, path: Set<UidxNode> = new Set()): boolean {
    const definition = this.definitionOf(instance)
    if (!definition) return true
    if (path.has(definition)) return false
    const variants = this.variantsOf(definition)
    if (variants.length === 0) return true
    path.add(definition)
    const found = variants.some((source) => {
      const target = boxTargetOf(source)
      if (target.kind === 'instance') return this.boxLaysOut(target.node, path)
      return laysOut(target.kind === 'frame' ? target.node : source)
    })
    path.delete(definition)
    return found
  }

  /**
   * Whether anything `textFills` reaches is a text (ADR 0018 §4): one of the
   * component's own, one a nested instance draws, or one the use fills a slot
   * with. Every text the component holds is in the tree as written, in one
   * variant or another — a styles table copies its texts and never adds one.
   */
  drawsText(instance: UidxNode, path: Set<UidxNode> = new Set()): boolean {
    if (instance.children.some((fill) => this.holdsText(fill, path))) return true
    const definition = this.definitionOf(instance)
    if (!definition) return true
    if (path.has(definition)) return false
    path.add(definition)
    const found = definition.children.some((child) => this.holdsText(child, path))
    path.delete(definition)
    return found
  }

  private holdsText(node: UidxNode, path: Set<UidxNode>): boolean {
    if (node.element === 'Text') return true
    if (node.element === 'Instance') return this.drawsText(node, path)
    return node.children.some((child) => this.holdsText(child, path))
  }

  /** The `<Component>` an instance names, or undefined when it is not there to read. */
  private definitionOf(instance: UidxNode): UidxNode | undefined {
    const name = instance.attrs.component?.value
    if (typeof name !== 'string' || aliasTarget(name) !== null) return undefined
    return this.components.get(name)
  }

  /** What a component may draw: each of its variants, derived or authored, or itself. */
  private variantsOf(definition: UidxNode): UidxNode[] {
    let derived = this.derived.get(definition)
    if (!derived) this.derived.set(definition, (derived = deriveVariants(definition)))
    if (!hasVariants(derived)) return [derived]
    return derived.children.filter((child) => child.element === 'Variant')
  }
}
