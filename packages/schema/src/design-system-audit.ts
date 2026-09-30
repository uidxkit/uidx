import {
  aliasTarget,
  CODES,
  diagnostic,
  hasVariants,
  slots as slotsOf,
  type Diagnostic,
  type ModelSpec,
  type UidxDocument,
  type UidxNode,
} from '@uidx/format'
import { isKnownProp } from './known-props.js'
import {
  axesOf,
  enumValues,
  modelByRef,
  modelOfType,
  repeatListType,
  repeatModel,
  repeatOf,
  ROOT_PART,
  stateKind,
  type RepeatScope,
  styleTarget,
  STATE_AXIS,
  DEFAULT_STATE,
  type ModelIndex,
} from './design-system.js'

/**
 * The rules that make the design-system regions a contract rather than
 * documentation (ADRs 0013–0017). Cross-region checks only: the parser has
 * already refused a malformed region, and these ask whether the regions
 * agree with each other and with the tree.
 *
 * Pure: a document in, diagnostics out. `uidx check` runs it on every page.
 */
export function auditDesignSystem(doc: UidxDocument, models?: ModelIndex): Diagnostic[] {
  const out: Diagnostic[] = []
  const error = (code: string, message: string, loc: { start: number; end: number }) =>
    out.push(diagnostic(doc.source, code, message, loc))
  const warn = (code: string, message: string, loc: { start: number; end: number }) =>
    out.push(diagnostic(doc.source, code, message, loc, 'warning'))

  const spec = doc.spec
  const components = doc.tree.children.filter((node) => node.element === 'Component')

  /* ------------------------------------------------------------ models */
  // A model is named by a prop's type (ADR 0015 §2) and may live on another
  // page. Without an index only this page can answer, so a name nobody here
  // declares is left alone; `uidx check` passes the whole document's.
  // A field that is a model, or a list of one, draws through that model's
  // samples and needs none of its own.
  for (const model of spec?.models ?? []) {
    for (const field of model.fields) {
      if (!field.optional && field.sample === undefined && !modelOfType(field.type, spec, models)) {
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
    const declaredParts = new Set(
      (contract?.parts ?? []).map((part) => part.name).filter((part) => part !== ROOT_PART),
    )
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
            `part "${part}" is described in <Parts> but no node binds it with part="${part}"`,
            contract.parts.find((entry) => entry.name === part)?.loc ?? contract.loc,
          )
        }
      }
    }

    /* ------------------------------------------------------------- slots */
    if (contract) {
      const inTree = slotsOf(component).declared
      for (const slot of contract.slots) {
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
    // A repeat names a list of the contract or of an enclosing repeat's item
    // (ADR 0017 §2); its `as` must not hide a prop or an outer item; a slot
    // that repeats may constrain what fills it with `accepts`.
    const propNames = new Set((contract?.props ?? []).map((prop) => prop.name))
    const checkRepeats = (node: UidxNode, enclosing: RepeatScope[]): void => {
      const repeat = repeatOf(node)
      let inner = enclosing
      if (repeat) {
        const model = repeatModel(repeat, spec, enclosing, models)
        const placed = model ? undefined : repeatListType(repeat, spec, enclosing, models)
        if (!model && placed === undefined) {
          error(
            CODES.BAD_REPEAT,
            `repeat="{${repeat.list}}" is not a list prop of the contract or a list field of an enclosing repeat's item`,
            node.attrs.repeat!.loc,
          )
        } else if (!model && placed && models) {
          // Placed by type, and every page is in the index, yet no model: the
          // type names nothing. A page audited alone says nothing here, since
          // the model may well be on a page it was not handed.
          error(
            CODES.BAD_REPEAT,
            `repeat="{${repeat.list}}" draws ${placed.slice(0, -2)}, which no page declares`,
            node.attrs.repeat!.loc,
          )
        } else if (!model) {
          // Unknown here; nothing to check.
        } else if (model.fields.filter((field) => field.key).length !== 1) {
          // Rows need an identity the code render can key on (ADR 0015 §1).
          error(
            CODES.MODEL_FIELD,
            `repeat="{${repeat.list}}" draws ${model.name}, so exactly one of its fields must be the key; found ${model.fields.filter((field) => field.key).length}`,
            node.attrs.repeat!.loc,
          )
        }
        if (propNames.has(repeat.as) || enclosing.some((scope) => scope.as === repeat.as)) {
          error(
            CODES.BAD_REPEAT,
            `as="${repeat.as}" hides a prop or an enclosing repeat's item; choose another name`,
            (node.attrs.as ?? node.attrs.repeat!).loc,
          )
        }
        if (node.element === 'Slot') {
          const slot = contract?.slots.find((entry) => entry.name === node.name)
          const child = node.children[0]
          if (slot?.accepts && child?.element === 'Instance') {
            const name = child.attrs.component?.value
            const definition = components.find((entry) => entry.name === name)
            const implemented = definition?.attrs.implements?.value
            if (definition && implemented !== slot.accepts) {
              error(
                CODES.BAD_REPEAT,
                `slot "${node.name}" accepts ${slot.accepts}, but "${name}" implements ${typeof implemented === 'string' ? implemented : 'nothing'}`,
                child.loc,
              )
            }
          }
        }
        inner = [...enclosing, { as: repeat.as, model }]
      }
      if (node.element !== 'Instance') for (const child of node.children) checkRepeats(child, inner)
    }
    for (const child of component.children) checkRepeats(child, [])

    /* ---------------------------------------------------------- bindings */
    const modelProps = new Map(
      (contract?.props ?? [])
        .filter((prop) => modelOfType(prop.type, spec, models)?.list === false)
        .map((prop) => [prop.name, prop]),
    )
    const checkBindings = (node: UidxNode, enclosing: RepeatScope[]): void => {
      for (const [attrName, attr] of Object.entries(node.attrs)) {
        if (attrName === 'repeat') continue
        const target = typeof attr.value === 'string' ? aliasTarget(attr.value) : null
        if (target === null || target.includes('#') || !target.includes('.')) continue
        const [head, ...path] = target.split('.')
        const scope = [...enclosing].reverse().find((entry) => entry.as === head)
        const prop = modelProps.get(head!)
        if (!scope && !prop) {
          error(
            CODES.BINDING,
            `"{${target}}" binds a field of "${head}", which is neither a prop with a model nor the item of an enclosing repeat`,
            attr.loc,
          )
          continue
        }
        let model: ModelSpec | undefined = scope
          ? scope.model
          : modelOfType(prop!.type, spec, models)?.model
        if (scope && !model) continue // the repeat itself was reported
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
          model = modelByRef(spec, field.type, models)
        }
      }
      const repeat = repeatOf(node)
      const inner = repeat
        ? [...enclosing, { as: repeat.as, model: repeatModel(repeat, spec, enclosing, models) }]
        : enclosing
      for (const child of node.children) checkBindings(child, inner)
    }
    for (const child of component.children) checkBindings(child, [])

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
        if (axis === STATE_AXIS) {
          if (stateKind(value, contract) === undefined) {
            const prop = contract?.props.find((entry) => entry.name === value)
            error(
              CODES.STYLE_ROW,
              prop?.type === 'boolean'
                ? `<Style state="${value}">: "${value}" is a boolean prop; mark it visual to draw it as a state`
                : `<Style state="${value}">: "${value}" is not a visual boolean prop, an interaction state (hover, focus, active) or a <State> the element declares`,
              row.loc,
            )
          }
        } else if (!domain) {
          error(
            CODES.STYLE_ROW,
            `<Style ${axis}="${value}">: "${axis}" is not a visual enum prop of the contract`,
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

    /* ------------------------------------------------ derivable variants */
    // ADR 0016 §5: trees that share one anatomy and differ only in values are
    // appearance variants written by hand. Suggested, never rewritten.
    const variants = component.children.filter((node) => node.element === 'Variant')
    if (variants.length >= 2) {
      const shape = anatomy(variants[0]!)
      if (variants.every((variant) => anatomy(variant) === shape)) {
        warn(
          CODES.DERIVABLE_VARIANTS,
          `"${component.name}" writes ${variants.length} <Variant> trees with one anatomy that differ only in values; ` +
            'declare the axes as visual props in ## Contract and give each value a <Style> row instead (ADR 0016)',
          component.loc,
        )
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

/** A subtree's anatomy: elements and names in order, values ignored. */
function anatomy(node: UidxNode): string {
  const children = node.children.map((child) => `${child.element}:${child.name}(${anatomy(child)})`)
  return children.join(',')
}
