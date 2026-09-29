import {
  aliasTarget,
  CODES,
  diagnostic,
  hasVariants,
  slots as slotsOf,
  type Diagnostic,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'
import { isKnownProp } from './known-props.js'
import {
  axesOf,
  enumValues,
  modelByRef,
  ROOT_PART,
  styleTarget,
  STATE_AXIS,
  DEFAULT_STATE,
} from './design-system.js'

/**
 * The rules that make the design-system regions a contract rather than
 * documentation (ADRs 0013–0017). Cross-region checks only: the parser has
 * already refused a malformed region, and these ask whether the regions
 * agree with each other and with the tree.
 *
 * Pure: a document in, diagnostics out. `uidx check` runs it on every page.
 */
export function auditDesignSystem(doc: UidxDocument): Diagnostic[] {
  const out: Diagnostic[] = []
  const error = (code: string, message: string, loc: { start: number; end: number }) =>
    out.push(diagnostic(doc.source, code, message, loc))
  const warn = (code: string, message: string, loc: { start: number; end: number }) =>
    out.push(diagnostic(doc.source, code, message, loc, 'warning'))

  const spec = doc.spec
  const components = doc.tree.children.filter((node) => node.element === 'Component')

  /* ------------------------------------------------------------ models */
  const usedByRepeat = new Set<string>()
  for (const slot of spec?.contract?.slots ?? []) {
    const model = modelByRef(spec, slot.model)
    if (slot.model && !model) {
      error(
        CODES.MODEL_FIELD,
        `slot "${slot.name}" names a model that is not declared: ${slot.model}`,
        slot.loc,
      )
    }
    if (model) usedByRepeat.add(model.name)
  }
  for (const prop of spec?.contract?.props ?? []) {
    if (prop.model && !modelByRef(spec, prop.model)) {
      error(
        CODES.MODEL_FIELD,
        `prop "${prop.name}" names a model that is not declared: ${prop.model}`,
        prop.loc,
      )
    }
  }
  for (const model of spec?.models ?? []) {
    const keys = model.fields.filter((field) => field.key)
    if (usedByRepeat.has(model.name) && keys.length !== 1) {
      error(
        CODES.MODEL_FIELD,
        `model "${model.name}" fills a repeating slot, so exactly one field must be its key; found ${keys.length}`,
        model.loc,
      )
    }
    for (const field of model.fields) {
      if (!field.optional && field.sample === undefined && !modelByRef(spec, field.type)) {
        error(
          CODES.MODEL_FIELD,
          `field "${model.name}.${field.name}" is required, so it needs a sample the design tools can draw`,
          field.loc,
        )
      }
    }
  }

  for (const component of components) {
    const contract = spec?.contract
    const rows = spec?.styles ?? []

    /* -------------------------------------------------------- props attr */
    if (contract && component.attrs.props) {
      warn(
        CODES.BAD_SPEC,
        'this component declares a ## Contract, so the "props" attribute is redundant; move its entries to <Props>',
        component.attrs.props.loc,
      )
    }

    /* ------------------------------------------------------------- parts */
    const declaredParts = new Set((contract?.parts ?? []).filter((part) => part !== ROOT_PART))
    const bound = new Map<string, UidxNode[]>()
    const walk = (node: UidxNode): void => {
      const part = node.attrs.part?.value
      if (typeof part === 'string') (bound.get(part) ?? bound.set(part, []).get(part)!).push(node)
      for (const child of node.children) walk(child)
    }
    for (const child of component.children) walk(child)
    if (component.attrs.part) {
      error(
        CODES.PART_BINDING,
        'the component is the "root" part itself (ADR 0016 §2); remove part= from <Component>',
        component.attrs.part.loc,
      )
    }
    for (const [part, nodes] of bound) {
      if (part === ROOT_PART) {
        error(
          CODES.PART_BINDING,
          'part="root" is the component itself; a child cannot be the root part',
          nodes[0]!.attrs.part!.loc,
        )
        continue
      }
      if (contract && !declaredParts.has(part)) {
        error(
          CODES.PART_BINDING,
          `part="${part}" is not declared in <Parts>`,
          nodes[0]!.attrs.part!.loc,
        )
      }
      if (nodes.length > 1) {
        error(
          CODES.PART_BINDING,
          `part="${part}" is bound ${nodes.length} times; one node per part`,
          nodes[1]!.attrs.part!.loc,
        )
      }
    }
    if (contract) {
      for (const part of declaredParts) {
        if (!bound.has(part)) {
          error(
            CODES.PART_BINDING,
            `part "${part}" is declared in <Parts> but no node binds it with part="${part}"`,
            contract.loc,
          )
        }
      }
    }

    /* ------------------------------------------------------------- slots */
    if (contract) {
      const inTree = slotsOf(component).declared
      for (const slot of contract.slots) {
        if (slot.repeats) continue
        if (!inTree.has(slot.name)) {
          error(
            CODES.SLOT_BINDING,
            `slot "${slot.name}" is declared in <Slots> but the tree has no <Slot name="${slot.name}">`,
            slot.loc,
          )
        }
      }
      for (const [name, node] of inTree) {
        if (!contract.slots.some((slot) => slot.name === name)) {
          error(CODES.SLOT_BINDING, `<Slot name="${name}"> is not declared in <Slots>`, node.loc)
        }
      }
    }

    /* ----------------------------------------------------------- repeats */
    const repeats: UidxNode[] = []
    const findRepeats = (node: UidxNode): void => {
      if (node.element === 'Repeat') repeats.push(node)
      for (const child of node.children) findRepeats(child)
    }
    for (const child of component.children) findRepeats(child)
    for (const repeat of repeats) {
      const slotName = repeat.attrs.slot!.value as string
      const slot = contract?.slots.find((entry) => entry.name === slotName)
      if (!slot) {
        error(
          CODES.BAD_REPEAT,
          `<Repeat slot="${slotName}"> names no slot of the contract`,
          repeat.attrs.slot!.loc,
        )
      } else if (!slot.repeats) {
        error(
          CODES.BAD_REPEAT,
          `<Repeat slot="${slotName}"> multiplies a slot the contract does not declare as repeating`,
          repeat.attrs.slot!.loc,
        )
      }
      const child = repeat.children[0]
      if (child && child.element !== 'Instance') {
        error(
          CODES.BAD_REPEAT,
          `<Repeat> holds an <Instance> of an accepted component; found <${child.element}>`,
          child.loc,
        )
      }
      if (child?.element === 'Instance' && slot?.accepts) {
        const name = child.attrs.component?.value
        const definition = components.find((entry) => entry.name === name)
        const implemented = definition?.attrs.implements?.value
        if (definition && implemented !== slot.accepts) {
          error(
            CODES.BAD_REPEAT,
            `slot "${slotName}" accepts ${slot.accepts}, but "${name}" implements ${typeof implemented === 'string' ? implemented : 'nothing'}`,
            child.loc,
          )
        }
      }
    }

    /* ---------------------------------------------------------- bindings */
    const modelProps = new Map(
      (contract?.props ?? []).filter((prop) => prop.model).map((prop) => [prop.name, prop]),
    )
    const checkBindings = (node: UidxNode): void => {
      for (const attr of Object.values(node.attrs)) {
        const target = typeof attr.value === 'string' ? aliasTarget(attr.value) : null
        if (target === null || target.includes('#') || !target.includes('.')) continue
        const [head, ...path] = target.split('.')
        const prop = modelProps.get(head!)
        if (!prop) {
          error(
            CODES.BINDING,
            `"{${target}}" binds a field of "${head}", which is not a prop with a model`,
            attr.loc,
          )
          continue
        }
        let model = modelByRef(spec, prop.model)
        for (const segment of path) {
          const field = model?.fields.find((entry) => entry.name === segment)
          if (!field) {
            error(
              CODES.BINDING,
              `"{${target}}": model "${model?.name ?? '?'}" has no field "${segment}"`,
              attr.loc,
            )
            model = undefined
            break
          }
          model = modelByRef(spec, field.type)
        }
      }
      for (const child of node.children) checkBindings(child)
    }
    for (const child of component.children) checkBindings(child)

    /* ------------------------------------------------------------ styles */
    if (rows.length && hasVariants(component)) {
      error(
        CODES.STYLE_ROW,
        'a component with a <Styles> table derives its variants; remove the "variants" attribute and its <Variant> trees, or the table',
        component.attrs.variants!.loc,
      )
    }
    const axes = axesOf(spec)
    for (const row of rows) {
      for (const [axis, value] of Object.entries(row.keys)) {
        const domain = axes.get(axis)
        if (!domain) {
          error(
            CODES.STYLE_ROW,
            axis === STATE_AXIS
              ? `<Style state="${value}">: the contract declares no states`
              : `<Style ${axis}="${value}">: "${axis}" is not a visual enum prop of the contract`,
            row.loc,
          )
        } else if (!domain.includes(value)) {
          error(
            CODES.STYLE_ROW,
            `<Style ${axis}="${value}">: "${value}" is not one of ${domain.join(', ')}`,
            row.loc,
          )
        }
      }
      for (const [part, props] of Object.entries(row.values)) {
        if (part !== ROOT_PART && !styleTarget(component, part)) {
          error(
            CODES.STYLE_ROW,
            `<Style> names "${part}", which is neither a bound part nor the name of a node in the tree`,
            row.loc,
          )
        }
        for (const prop of Object.keys(props)) {
          if (!isKnownProp(prop))
            warn(CODES.STYLE_ROW, `<Style> sets "${prop}", which is not a scene property`, row.loc)
        }
      }
    }
    if (rows.length) {
      const covered = new Set<string>()
      for (const row of rows)
        for (const [axis, value] of Object.entries(row.keys)) covered.add(`${axis}=${value}`)
      for (const [axis, domain] of axes) {
        for (const value of domain) {
          const isDefault = domain[0] === value || (axis === STATE_AXIS && value === DEFAULT_STATE)
          if (isDefault || covered.has(`${axis}=${value}`)) continue
          warn(
            CODES.AXIS_UNCOVERED,
            `${axis}="${value}" has no <Style> row, so it renders exactly like the default`,
            spec!.contract!.loc,
          )
        }
      }
    }

    /* ---------------------------------------------------- visual props */
    for (const prop of contract?.props ?? []) {
      if (prop.visual && prop.type && !enumValues(prop.type) && prop.type !== 'boolean') {
        warn(
          CODES.BAD_SPEC,
          `prop "${prop.name}" is visual but its type is neither an enum nor boolean, so it cannot be an axis`,
          prop.loc,
        )
      }
    }
  }

  return out
}
