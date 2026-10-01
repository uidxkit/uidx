import { parseExpression, ValueError } from './values.js'
import { CODES, diagnostic } from './diagnostics.js'
import type {
  BehaviorRule,
  ContractSpec,
  Diagnostic,
  DocumentSpec,
  EventSpec,
  ExampleSet,
  ExampleSpec,
  FieldSpec,
  JsonValue,
  ModelSpec,
  PartSpec,
  PropSpec,
  Range,
  SlotSpec,
  SpecNode,
  StateSpec,
  StyleRow,
} from './types.js'

/**
 * The regions after the visual contract (ADRs 0013–0016), lowered.
 *
 * These are declarations, not scene nodes: a `<Prop>` draws nothing and has
 * no address in the scene graph. So they are lowered generically — name,
 * evaluated attributes, text, children — and the typed shapes are built from
 * that, with every shape problem a diagnostic rather than a crash. The
 * generic tree is kept as well: `uidx contract` prints it, so a generator
 * sees exactly what was written even for an element this file does not type.
 */

/** The mdast slice this module reads. Kept loose: mdast is untyped here. */
export interface MdastLike {
  type: string
  name?: string
  value?: string
  attributes?: { type: string; name?: string; value?: unknown }[]
  children?: MdastLike[]
  position: { start: { offset: number }; end: { offset: number } }
}

export const REGION_NAMES = ['Contract', 'Behavior', 'Models', 'Examples'] as const
export type RegionName = (typeof REGION_NAMES)[number]

const CONTRACT_ELEMENTS: Record<string, readonly string[]> = {
  Props: ['Prop'],
  Events: ['Event'],
  States: ['State'],
  Parts: ['Part'],
  Slots: ['Slot'],
  Form: [],
  Accessibility: [],
  Composes: [],
}
const MODEL_ELEMENTS: Record<string, readonly string[]> = { Model: ['Field'] }
const EXAMPLE_ELEMENTS: Record<string, readonly string[]> = { Example: ['Set'] }

function rangeOf(node: MdastLike): Range {
  return { start: node.position.start.offset, end: node.position.end.offset }
}

function textOf(node: MdastLike): string {
  if (typeof node.value === 'string') return node.value
  return (node.children ?? []).map(textOf).join('')
}

/** Lowers one JSX element and its subtree, reporting shape problems. */
export class SpecLowerer {
  readonly diagnostics: Diagnostic[] = []
  constructor(private readonly source: string) {}

  private error(code: string, message: string, loc: Range): void {
    this.diagnostics.push(diagnostic(this.source, code, message, loc))
  }

  /**
   * Attributes with the spec regions' one relaxation over the visual
   * contract: a bare boolean (`controllable`, `key`, `repeats`) is allowed,
   * because these are declarations and a flag reads better than `={true}`.
   */
  attributes(el: MdastLike): Record<string, JsonValue> {
    const attrs: Record<string, JsonValue> = {}
    for (const raw of el.attributes ?? []) {
      const loc = rangeOf(el)
      if (raw.type !== 'mdxJsxAttribute' || !raw.name) {
        this.error(CODES.SPREAD_ATTR, 'spread attributes are not part of the UIDX grammar', loc)
        continue
      }
      if (raw.name in attrs) {
        this.error(CODES.DUPLICATE_ATTR, `duplicate attribute "${raw.name}"`, loc)
        continue
      }
      if (raw.value === null || raw.value === undefined) {
        attrs[raw.name] = true
        continue
      }
      if (typeof raw.value === 'string') {
        attrs[raw.name] = raw.value
        continue
      }
      const inner = (raw.value as { value?: string }).value ?? ''
      try {
        attrs[raw.name] = parseExpression(inner)
      } catch (err) {
        const message = err instanceof ValueError ? err.message : String(err)
        this.error(CODES.BAD_VALUE, `attribute "${raw.name}": ${message}`, loc)
      }
    }
    return attrs
  }

  element(
    el: MdastLike,
    allowed: Record<string, readonly string[]>,
    parent: string | null,
  ): SpecNode | null {
    const name = el.name ?? ''
    const loc = rangeOf(el)
    const legal = parent === null ? Object.keys(allowed) : (allowed[parent] ?? [])
    if (!legal.includes(name)) {
      this.error(
        CODES.UNKNOWN_SPEC_ELEMENT,
        parent === null
          ? `unknown element <${name || '?'}> here; allowed: ${legal.join(', ')}`
          : `<${name || '?'}> is not allowed inside <${parent}>; allowed: ${legal.length ? legal.join(', ') : 'nothing'}`,
        loc,
      )
      return null
    }
    const node: SpecNode = { name, attrs: this.attributes(el), text: '', children: [], loc }
    const text: string[] = []
    this.walk(el.children ?? [], allowed, name, node.children, text)
    node.text = text.join(' ').replace(/\s+/g, ' ').trim()
    return node
  }

  /**
   * Collects the JSX elements and the text among `nodes`.
   *
   * MDX parses an element that sits on one line with its text —
   * `<Prop name="x">Its description.</Prop>` — as a paragraph holding a
   * *text* element, and one on its own lines as a *flow* element. Both are
   * the same declaration to this module, so paragraphs are looked into and
   * either kind is lowered; what is left is the description text.
   */
  private walk(
    nodes: MdastLike[],
    allowed: Record<string, readonly string[]>,
    parent: string | null,
    into: SpecNode[],
    text: string[],
  ): void {
    for (const child of nodes) {
      if (child.type === 'mdxJsxFlowElement' || child.type === 'mdxJsxTextElement') {
        const lowered = this.element(child, allowed, parent)
        if (lowered) into.push(lowered)
      } else if (child.type === 'mdxFlowExpression' || child.type === 'mdxTextExpression') {
        continue
      } else if (child.type === 'paragraph') {
        this.walk(child.children ?? [], allowed, parent, into, text)
      } else {
        text.push(textOf(child))
      }
    }
  }

  /** Every JSX element among `nodes`, lowered; stray prose is reported. */
  elements(
    nodes: MdastLike[],
    allowed: Record<string, readonly string[]>,
    region: string,
  ): SpecNode[] {
    const out: SpecNode[] = []
    for (const node of nodes) {
      const text: string[] = []
      this.walk([node], allowed, null, out, text)
      if (text.join('').trim() !== '') {
        this.error(
          CODES.UNEXPECTED_CONTRACT_CONTENT,
          `the ${region} region holds elements and MDX comments only`,
          rangeOf(node),
        )
      }
    }
    return out
  }

  /* ---------------------------------------------------------- contract */

  private str(node: SpecNode, attr: string, required = true): string | undefined {
    const value = node.attrs[attr]
    if (typeof value === 'string' && value !== '') return value
    if (value === undefined && !required) return undefined
    this.error(
      CODES.BAD_SPEC,
      value === undefined
        ? `<${node.name}> needs a "${attr}" attribute`
        : `<${node.name}> "${attr}" must be a non-empty string`,
      node.loc,
    )
    return undefined
  }

  private flag(node: SpecNode, attr: string): boolean {
    const value = node.attrs[attr]
    if (value === undefined || value === false) return false
    if (value === true) return true
    this.error(
      CODES.BAD_SPEC,
      `<${node.name}> "${attr}" is a flag: write it bare or ={true}`,
      node.loc,
    )
    return false
  }

  private described(node: SpecNode): string {
    if (node.text === '') {
      this.error(
        CODES.BAD_SPEC,
        `<${node.name}${typeof node.attrs.name === 'string' ? ` name="${node.attrs.name}"` : ''}> needs a description as its text content`,
        node.loc,
      )
    }
    return node.text
  }

  private names(node: SpecNode): string[] {
    return node.text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
  }

  private stringList(node: SpecNode, attr: string): string[] {
    const value = node.attrs[attr]
    if (value === undefined) return []
    if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
      return value as string[]
    }
    this.error(CODES.BAD_SPEC, `<${node.name}> "${attr}" must be an array of strings`, node.loc)
    return []
  }

  contract(nodes: MdastLike[], loc: Range): ContractSpec {
    const spec: ContractSpec = {
      props: [],
      events: [],
      states: [],
      parts: [],
      slots: [],
      composes: [],
      loc,
    }
    const seen = new Set<string>()
    for (const node of this.elements(nodes, CONTRACT_ELEMENTS, 'Contract')) {
      if (seen.has(node.name) && node.name !== 'Composes') {
        this.error(CODES.BAD_SPEC, `<${node.name}> is declared twice`, node.loc)
        continue
      }
      seen.add(node.name)
      switch (node.name) {
        case 'Props':
          for (const child of node.children) {
            const name = this.str(child, 'name')
            if (!name) continue
            if (child.attrs.model !== undefined) {
              this.error(
                CODES.BAD_SPEC,
                `<Prop name="${name}">: a model is named by its type — write type="Contact" (ADR 0015 §2)`,
                child.loc,
              )
            }
            const type = this.str(child, 'type')
            if (!type) continue
            if (spec.props.some((prop) => prop.name === name)) {
              this.error(CODES.BAD_SPEC, `<Prop name="${name}"> is declared twice`, child.loc)
              continue
            }
            const prop: PropSpec = {
              name,
              type,
              controllable: this.flag(child, 'controllable'),
              visual: this.flag(child, 'visual'),
              description: this.described(child),
              loc: child.loc,
            }
            if (child.attrs.default !== undefined) prop.default = child.attrs.default
            if (child.attrs.sample !== undefined) prop.sample = child.attrs.sample
            spec.props.push(prop)
          }
          break
        case 'Events':
          for (const child of node.children) {
            const name = this.str(child, 'name')
            if (!name) continue
            const event: EventSpec = { name, description: this.described(child), loc: child.loc }
            const detail = this.str(child, 'detail', false)
            if (detail) event.detail = detail
            spec.events.push(event)
          }
          break
        case 'States':
          if (node.attrs.structural !== undefined || node.attrs.styling !== undefined) {
            this.error(
              CODES.BAD_SPEC,
              '<States>: a boolean prop marked visual is a state already; declare here only the states the element produces itself, as <State name="…">',
              node.loc,
            )
          }
          for (const child of node.children) {
            const name = this.str(child, 'name')
            if (!name) continue
            if (spec.states.some((state) => state.name === name)) {
              this.error(CODES.BAD_SPEC, `<State name="${name}"> is declared twice`, child.loc)
              continue
            }
            const state: StateSpec = { name, description: this.described(child), loc: child.loc }
            spec.states.push(state)
          }
          break
        case 'Parts':
          if (node.text !== '' && node.children.length === 0) {
            this.error(
              CODES.BAD_SPEC,
              '<Parts> lists parts as <Part name="…">description</Part> children',
              node.loc,
            )
          }
          for (const child of node.children) {
            const name = this.str(child, 'name')
            if (!name) continue
            if (spec.parts.some((part) => part.name === name)) {
              this.error(CODES.BAD_SPEC, `<Part name="${name}"> is declared twice`, child.loc)
              continue
            }
            const part: PartSpec = { name, description: child.text, loc: child.loc }
            spec.parts.push(part)
          }
          break
        case 'Slots':
          for (const child of node.children) {
            const name = this.str(child, 'name')
            if (!name) continue
            const slot: SlotSpec = { name, description: this.described(child), loc: child.loc }
            const accepts = this.str(child, 'accepts', false)
            if (accepts) slot.accepts = accepts
            if (
              child.attrs.model !== undefined ||
              child.attrs.repeats !== undefined ||
              child.attrs.of !== undefined
            ) {
              this.error(
                CODES.BAD_SPEC,
                `<Slot name="${name}">: whether a slot repeats is the tree's to say — write repeat="{items}" on the <Slot> in the visual contract (ADR 0017 §2)`,
                child.loc,
              )
            }
            spec.slots.push(slot)
          }
          break
        case 'Form': {
          const form: ContractSpec['form'] = { participates: this.flag(node, 'participates') }
          const submits = this.str(node, 'submits', false)
          if (submits) form.submits = submits
          spec.form = form
          break
        }
        case 'Accessibility':
          spec.accessibility = { ...node.attrs }
          break
        case 'Composes': {
          const value = node.attrs.with
          if (typeof value === 'string')
            spec.composes.push(...value.split(',').map((s) => s.trim()))
          else if (Array.isArray(value))
            spec.composes.push(...value.filter((v): v is string => typeof v === 'string'))
          else
            this.error(
              CODES.BAD_SPEC,
              '<Composes> needs a "with" attribute naming components',
              node.loc,
            )
          break
        }
      }
    }
    return spec
  }

  /* ------------------------------------------------------------ models */

  models(nodes: MdastLike[]): ModelSpec[] {
    const out: ModelSpec[] = []
    for (const node of this.elements(nodes, MODEL_ELEMENTS, 'Models')) {
      const name = this.str(node, 'name')
      if (!name) continue
      if (out.some((model) => model.name === name)) {
        this.error(CODES.BAD_SPEC, `<Model name="${name}"> is declared twice`, node.loc)
        continue
      }
      const model: ModelSpec = { name, description: node.text, fields: [], loc: node.loc }
      for (const child of node.children) {
        const fieldName = this.str(child, 'name')
        const type = this.str(child, 'type')
        if (!fieldName || !type) continue
        if (model.fields.some((field) => field.name === fieldName)) {
          this.error(
            CODES.BAD_SPEC,
            `<Field name="${fieldName}"> is declared twice in ${name}`,
            child.loc,
          )
          continue
        }
        const field: FieldSpec = {
          name: fieldName,
          type,
          key: this.flag(child, 'key'),
          optional: this.flag(child, 'optional'),
          description: this.described(child),
          loc: child.loc,
        }
        if (child.attrs.sample !== undefined) field.sample = child.attrs.sample
        model.fields.push(field)
      }
      out.push(model)
    }
    return out
  }

  /* ---------------------------------------------------------- examples */

  examples(nodes: MdastLike[]): ExampleSpec[] {
    const out: ExampleSpec[] = []
    for (const node of this.elements(nodes, EXAMPLE_ELEMENTS, 'Examples')) {
      const name = this.str(node, 'name')
      if (!name) continue
      const example: ExampleSpec = { name, sets: [], loc: node.loc }
      for (const child of node.children) {
        const set: ExampleSet = { loc: child.loc }
        const slot = this.str(child, 'slot', false)
        const at = this.str(child, 'at', false)
        const state = this.str(child, 'state', false)
        if (slot) set.slot = slot
        if (at) set.at = at
        if (state) set.state = state
        if (child.attrs.count !== undefined) {
          const count = child.attrs.count
          if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
            this.error(CODES.BAD_SPEC, '<Set> "count" must be a non-negative integer', child.loc)
          } else set.count = count
        }
        if (child.attrs.value !== undefined) set.value = child.attrs.value
        if (!slot && !at) {
          this.error(
            CODES.BAD_SPEC,
            '<Set> needs a "slot" or an "at" to say what it changes',
            child.loc,
          )
          continue
        }
        example.sets.push(set)
      }
      out.push(example)
    }
    return out
  }

  /* ------------------------------------------------------------ styles */

  /**
   * The styles table (ADR 0016 §2): each `<Style>` row splits into axis keys
   * — string-valued attributes without a colon — and `part:prop` values.
   */
  styles(el: MdastLike): StyleRow[] {
    const table = this.element(el, { Styles: ['Style'] }, null)
    if (!table) return []
    const rows: StyleRow[] = []
    for (const row of table.children) {
      const keys: Record<string, string> = {}
      const values: Record<string, Record<string, JsonValue>> = {}
      for (const [attr, value] of Object.entries(row.attrs)) {
        // `part:prop` — JSX allows a namespaced attribute name and not a dotted
        // one, which is why the separator is a colon.
        const dot = attr.indexOf(':')
        if (dot === -1) {
          if (typeof value !== 'string') {
            this.error(
              CODES.STYLE_ROW,
              `<Style> key "${attr}" must be an axis value written as a string`,
              row.loc,
            )
            continue
          }
          keys[attr] = value
          continue
        }
        const part = attr.slice(0, dot)
        const prop = attr.slice(dot + 1)
        if (!part || !prop) {
          this.error(CODES.STYLE_ROW, `<Style> "${attr}" must read part:prop`, row.loc)
          continue
        }
        ;(values[part] ??= {})[prop] = value
      }
      if (Object.keys(keys).length === 0) {
        this.error(
          CODES.STYLE_ROW,
          '<Style> needs at least one axis key, e.g. state="hover"',
          row.loc,
        )
        continue
      }
      rows.push({ keys, values, loc: row.loc })
    }
    return rows
  }

  /* ---------------------------------------------------------- behaviour */

  /**
   * `## Behavior` is prose: one bullet per rule, `id: sentence`. Only the id
   * and the text are read, so the sentence stays free to be a sentence.
   */
  behavior(nodes: MdastLike[]): BehaviorRule[] {
    const rules: BehaviorRule[] = []
    for (const node of nodes) {
      if (node.type !== 'list') {
        if (textOf(node).trim() !== '') {
          this.error(
            CODES.BAD_BEHAVIOR_RULE,
            'the Behavior region is a bullet list: one `id: sentence` per rule',
            rangeOf(node),
          )
        }
        continue
      }
      for (const item of node.children ?? []) {
        // Read from the source rather than the parsed text, which drops the
        // backticks of a `code` span: a rule names props and events that way.
        const range = rangeOf(item)
        const text = this.source
          .slice(range.start, range.end)
          .replace(/^\s*[-*+]\s+/, '')
          .replace(/\s+/g, ' ')
          .trim()
        const match = /^([a-z][a-z0-9-]*):\s*(.+)$/.exec(text)
        if (!match) {
          this.error(
            CODES.BAD_BEHAVIOR_RULE,
            'a behaviour rule starts with its id: `toggle: click or Space flips checked`',
            rangeOf(item),
          )
          continue
        }
        const [, id, sentence] = match
        if (rules.some((rule) => rule.id === id)) {
          this.error(
            CODES.BAD_BEHAVIOR_RULE,
            `behaviour rule "${id}" is written twice`,
            rangeOf(item),
          )
          continue
        }
        rules.push({ id: id!, text: sentence!, loc: rangeOf(item) })
      }
    }
    return rules
  }
}

/** One region after the visual contract: its heading and the nodes under it. */
export interface Region {
  name: RegionName
  nodes: MdastLike[]
  loc: Range
}

/** Builds `doc.spec` from the regions and the styles element, if any. */
export function buildSpec(
  source: string,
  regions: Region[],
  styles: MdastLike | null,
): { spec: DocumentSpec | undefined; diagnostics: Diagnostic[] } {
  const lowerer = new SpecLowerer(source)
  const spec: DocumentSpec = {}
  for (const region of regions) {
    switch (region.name) {
      case 'Contract':
        spec.contract = lowerer.contract(region.nodes, region.loc)
        break
      case 'Behavior':
        spec.behavior = lowerer.behavior(region.nodes)
        break
      case 'Models':
        spec.models = lowerer.models(region.nodes)
        break
      case 'Examples':
        spec.examples = lowerer.examples(region.nodes)
        break
    }
  }
  if (styles) spec.styles = lowerer.styles(styles)
  return {
    spec: Object.keys(spec).length ? spec : undefined,
    diagnostics: lowerer.diagnostics,
  }
}
