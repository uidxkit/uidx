import {
  CODES,
  isUnitLength,
  UNITLESS_NUMBER_PROPS,
  aliasTarget,
  BINDING_RULE,
  bindingFits,
  componentProps,
  componentVariants,
  defaultCombination,
  instanceProps,
  matchesType,
  positionAt,
  propertyBinding,
  PROPERTY_FIELD,
  scopesForProp,
  slotFills,
  slots,
  variantName,
  type Diagnostic,
  type UidxDocument,
  type UidxNode,
  type VariableScope,
  type VariableType,
} from '@uidx/format'

/**
 * Workspace-scoped diagnostics.
 *
 * A separate band from the parser's, because these are properties of a
 * *document* and the parser only ever sees one page. `UIDX010` predates the
 * band and keeps its number — the codes table promises stability.
 */
export const WORKSPACE_CODES = {
  DUPLICATE_PAGE_ID: 'UIDX010',
  DUPLICATE_COMPONENT: 'UIDX400',
  UNRESOLVED_REFERENCE: 'UIDX401',
  DUPLICATE_VARIABLE: 'UIDX402',
  REFERENCE_CYCLE: 'UIDX403',
  /** A component property bound to an attribute its type cannot fill (F6). */
  PROPERTY_BINDING_MISMATCH: 'UIDX404',
  /** An instance assigning a property its component does not declare (F7). */
  UNDECLARED_PROPERTY_VALUE: 'UIDX405',
  /** An instance assigning a value the declaration's type contradicts (F7). */
  PROPERTY_VALUE_MISMATCH: 'UIDX406',
  /** An instance asking for a variant combination the component does not have (F8). */
  MISSING_VARIANT: 'UIDX407',
  /** An alias whose target declares a different variable type (G8). */
  ALIAS_TYPE_MISMATCH: 'UIDX408',
  /** A binding to a variable whose scopes do not cover this property (G8). */
  SCOPE_VIOLATION: 'UIDX409',
  /** A fill naming a slot the component it is an instance of does not declare (F5). */
  UNKNOWN_SLOT: 'UIDX410',
  /** A fill for a slot no component declares any more — ADR 0007 §5's headline. */
  ORPHANED_SLOT_FILL: 'UIDX411',
  /** An `overrides` key whose path enters a slot this instance fills (ADR 0007 §4). */
  OVERRIDE_INTO_FILLED_SLOT: 'UIDX412',
} as const

export type SymbolKind = 'component' | 'variable'

export interface SymbolEntry {
  /** Global name, e.g. `Button/Primary` (ADR 0004 §2). */
  name: string
  kind: SymbolKind
  /** Workspace-relative page the symbol is declared in. */
  file: string
  line: number
  column: number
  /**
   * The declared type, for a variable (story G8).
   *
   * Carried on the entry rather than looked up through `@uidx/schema`, because
   * this package deliberately does not depend on it: `uidx check` must not drag
   * `@open-pencil/*` and CanvasKit in for the sake of four string literals.
   */
  variableType?: VariableType
  /** The declared scopes, for a variable (G8). Absent means `ALL_SCOPES`. */
  variableScopes?: readonly VariableScope[]
}

/**
 * Every globally-named thing in a document (ADR 0004 §2).
 *
 * Components and token variables share it, because ADR 0004 §2 has exactly one
 * namespace. Deliberately flat: a design system is a directory and a name
 * prefix, not a namespace, so there is nothing to key by beyond the name. A
 * variable's name is its address (`radius#md`), which puts the collection in
 * the name rather than around it.
 */
export interface SymbolTable {
  entries: readonly SymbolEntry[]
  get(name: string): SymbolEntry | undefined
  /** Near matches for a name that did not resolve, best first. */
  suggest(name: string, limit?: number): string[]
}

export interface PageSource {
  file: string
  doc: UidxDocument
}

export interface SymbolResult {
  table: SymbolTable
  /** Duplicate names, reported against both declarations. */
  diagnostics: (Diagnostic & { file: string })[]
}

/**
 * A lookup over entries already collected.
 *
 * Split out so a caller holding one page's entries can merge them with the
 * others' without walking every document again: the workspace re-indexes on
 * every save, and on a 33-page document that was 2.4s of walking trees that
 * had not changed. First declaration wins, which is the order `pages` is in.
 */
export function symbolTableOf(entries: readonly SymbolEntry[]): SymbolTable {
  const owners = new Map<string, SymbolEntry>()
  for (const entry of entries) if (!owners.has(entry.name)) owners.set(entry.name, entry)
  return {
    entries,
    get: (name) => owners.get(name),
    suggest: (name, limit = 3) => suggest(name, [...owners.keys()], limit),
  }
}

export function buildSymbolTable(pages: readonly PageSource[]): SymbolResult {
  const entries: SymbolEntry[] = []
  const diagnostics: (Diagnostic & { file: string })[] = []

  const owners = new Map<string, SymbolEntry>()
  const pageIds = new Map<string, string>()

  for (const { file, doc } of pages) {
    const id = doc.frontmatter.id
    if (typeof id === 'string') {
      const owner = pageIds.get(id)
      if (owner) {
        diagnostics.push({
          file,
          code: WORKSPACE_CODES.DUPLICATE_PAGE_ID,
          message: `duplicate page id "${id}" (also declared in ${owner})`,
          severity: 'error',
          loc: { start: 0, end: 0 },
          line: 1,
          column: 1,
        })
      } else {
        pageIds.set(id, file)
      }
    }

    // A token file declares variables; a page declares components. Both land in
    // one namespace, because ADR 0004 §2 has exactly one (G5).
    const declared =
      doc.tree.element === 'Tokens'
        ? doc.tree.children.flatMap((collection) =>
            collection.children.map((variable) => ({ node: variable, kind: 'variable' as const })),
          )
        : doc.tree.children
            .filter((node) => node.element === 'Component')
            .map((node) => ({ node, kind: 'component' as const }))

    for (const { node, kind } of declared) {
      // A variable's global name is its address — `radius#md` — so the
      // collection is part of the name rather than a namespace around it.
      const name = kind === 'variable' ? node.address : node.name
      const { line, column } = positionAt(doc.source, node.loc.start)
      const declaredType = node.attrs.type?.value
      const entry: SymbolEntry = {
        name,
        kind,
        file,
        line,
        column,
        ...(kind === 'variable' && typeof declaredType === 'string'
          ? { variableType: declaredType as VariableType }
          : {}),
        ...(kind === 'variable' && Array.isArray(node.attrs.scopes?.value)
          ? { variableScopes: node.attrs.scopes.value as VariableScope[] }
          : {}),
      }

      const owner = owners.get(name)
      if (owner) {
        // Reported against both, and phrased as the naming collision it usually
        // is: two design systems in one document sharing one namespace is the
        // expected way this happens, not a corrupt file.
        const at = `${owner.file}:${owner.line}:${owner.column}`
        diagnostics.push({
          file,
          code:
            kind === 'variable'
              ? WORKSPACE_CODES.DUPLICATE_VARIABLE
              : WORKSPACE_CODES.DUPLICATE_COMPONENT,
          message:
            `duplicate ${kind} name "${name}" (also declared at ${at}). ` +
            `${kind === 'variable' ? 'Variable' : 'Component'} names are global to the ` +
            'document — group them with "/", e.g. "Marketing/Button" and "App/Button"',
          severity: 'error',
          loc: node.loc,
          line,
          column,
        })
        continue
      }

      owners.set(name, entry)
      entries.push(entry)
    }
  }

  const table = symbolTableOf(entries)

  diagnostics.push(...checkReferences(pages, table))
  diagnostics.push(...checkInstanceValues(pages))
  return { table, diagnostics }
}

/** A diagnostic's position fields, aimed at one node's opening tag. */
function atNode(
  file: string,
  doc: UidxDocument,
  node: UidxNode,
): { file: string; loc: UidxNode['loc']; line: number; column: number } {
  const { line, column } = positionAt(doc.source, node.loc.start)
  return { file, loc: node.loc, line, column }
}

/**
 * What an `<Instance>` assigns, against what its component declares (story F7).
 *
 * A hand-edited file is the case that matters — the panel refuses both of these
 * before you can press anything — so they are reported here rather than only in
 * the viewer. Two different mistakes wanting two different sentences: a name
 * the component does not declare (usually a typo, or a property that has since
 * been removed) and a value its type contradicts.
 *
 * An instance whose component does not resolve is silent: `checkReferences`
 * already said so, and piling a property complaint on top of a missing
 * component tells the author nothing they can act on.
 */
function checkInstanceValues(pages: readonly PageSource[]): (Diagnostic & { file: string })[] {
  const out: (Diagnostic & { file: string })[] = []
  const declarations = componentNodes(pages)

  /**
   * Every slot name any component in the document declares (ADR 0007 §5).
   *
   * A fill with no slot is one fault with two fixes, and this set is what tells
   * them apart: a name nothing declares is a typo, a name something else still
   * declares is a slot that was deleted out from under this fill.
   */
  const everySlotName = new Set<string>()
  for (const component of declarations.values()) {
    for (const slotName of slots(component).declared.keys()) everySlotName.add(slotName)
  }

  for (const { file, doc } of pages) {
    if (doc.tree.element === 'Tokens') continue
    const walk = (node: UidxNode): void => {
      const attr = node.attrs.props
      const name = node.attrs.component?.value
      const component = typeof name === 'string' ? declarations.get(name) : undefined
      if (node.element === 'Instance' && component) {
        const declared = componentProps(component).declared
        // ADR 0005 §4: an axis is assigned through the same `props` object F7
        // fills in, and §2 makes the two names one namespace — so both are read
        // out of the same map here, and neither can be mistaken for the other.
        const { axes } = componentVariants(component)
        const known = [...declared.keys(), ...axes.keys()]

        const { line, column } = positionAt(
          doc.source,
          (attr ?? node.attrs.component!).valueLoc.start,
        )
        const at = {
          file,
          severity: 'error' as const,
          loc: (attr ?? node.attrs.component!).valueLoc,
          line,
          column,
        }

        let sound = true
        for (const [key, value] of instanceProps(node).values) {
          const domain = axes.get(key)
          if (domain) {
            if (typeof value !== 'string' || !domain.includes(value)) {
              sound = false
              const near = typeof value === 'string' ? suggest(value, domain) : []
              out.push({
                ...at,
                code: WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH,
                message:
                  `${JSON.stringify(value)} is not a value of "${key}" on "${name}" ` +
                  `(${domain.map((v) => JSON.stringify(v)).join(' | ')})` +
                  (near.length ? `. Did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : ''),
              })
            }
            continue
          }
          const declaration = declared.get(key)
          if (!declaration) {
            const near = suggest(key, known)
            out.push({
              ...at,
              code: WORKSPACE_CODES.UNDECLARED_PROPERTY_VALUE,
              message:
                `"${name}" declares no property "${key}"` +
                (near.length ? `. Did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : '') +
                (known.length === 0 ? '. It declares none at all' : ''),
            })
          } else if (!matchesType(declaration.type, value)) {
            out.push({
              ...at,
              code: WORKSPACE_CODES.PROPERTY_VALUE_MISMATCH,
              message:
                `"${key}" is ${declaration.type} on "${name}", so its value should be ` +
                `${declaration.type === 'BOOLEAN' ? 'true or false' : 'text'}, not ` +
                JSON.stringify(value),
            })
          }
        }

        // ADR 0005 §2: combinations may be sparse, so asking for one nobody
        // designed is a mistake at the *use* site rather than in the component.
        // Only asked when every axis value was legal — otherwise this would
        // repeat a complaint the loop above already made, in worse words.
        if (axes.size && sound) {
          const asked = askedCombination(node, axes)
          if (!component.children.some((child) => child.name === asked)) {
            out.push({
              ...at,
              code: WORKSPACE_CODES.MISSING_VARIANT,
              message:
                `"${name}" has no variant for ${asked} — it has ` +
                `${component.children.map((c) => c.name).join('; ')}`,
            })
          }
        }

        /*
         * Slot fills (F5, ADR 0007). Whether the hole a fill names exists is a
         * cross-page question by construction — the fill is in one page and the
         * `<Slot>` in another — so it is asked here rather than by the parser,
         * beside the same question about a property name.
         *
         * Reported at the *fill*, not at the instance's `component` attribute:
         * ADR 0007 §5's whole point is that deleting a slot names every site
         * that filled it, by page and address.
         */
        const declaredSlots = slots(component).declared
        const filled = slotFills(node).fills
        for (const [slotName, fill] of filled) {
          if (declaredSlots.has(slotName)) continue
          const here = { ...at, ...atNode(file, doc, fill) }
          // The same fault twice over, with two different fixes: add the slot
          // back, or delete the fill. Which one to say is decided by whether
          // any component in the document still declares the name.
          if (everySlotName.has(slotName)) {
            out.push({
              ...here,
              code: WORKSPACE_CODES.ORPHANED_SLOT_FILL,
              message:
                `"${name}" no longer declares a slot "${slotName}", but this instance still ` +
                `fills it. Either declare it again in "${name}", or delete this fill — its ` +
                'content is not drawn as it stands',
            })
          } else {
            const near = suggest(slotName, [...declaredSlots.keys()])
            out.push({
              ...here,
              code: WORKSPACE_CODES.UNKNOWN_SLOT,
              message:
                `"${name}" declares no slot "${slotName}"` +
                (declaredSlots.size
                  ? `; it declares ${[...declaredSlots.keys()].map((k) => `"${k}"`).join(', ')}`
                  : '. It declares none at all') +
                (near.length ? `. Did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : ''),
            })
          }
        }

        // ADR 0007 §4. An override reaches into the component by path and a
        // fill replaces that path wholesale, so both naming the same region is
        // two ways to say one thing with no stated winner.
        const overrides = node.attrs.overrides?.value
        if (
          filled.size &&
          overrides &&
          typeof overrides === 'object' &&
          !Array.isArray(overrides)
        ) {
          for (const key of Object.keys(overrides)) {
            for (const [slotName, slot] of declaredSlots) {
              if (!filled.has(slotName)) continue
              const inside = slot.address.slice(slot.address.indexOf('#') + 1)
              if (key !== inside && !key.startsWith(`${inside}/`)) continue
              out.push({
                ...at,
                code: WORKSPACE_CODES.OVERRIDE_INTO_FILLED_SLOT,
                message:
                  `the override "${key}" reaches inside the slot "${slotName}", which this ` +
                  'instance also fills. The fill replaces that content outright, so the ' +
                  'override cannot apply — keep one of the two',
              })
            }
          }
        }
      }
      node.children.forEach(walk)
    }
    walk(doc.tree)
  }
  return out
}

/**
 * The combination an instance is asking for (ADR 0005 §4).
 *
 * Every axis's default, with whatever the instance assigned laid over the top —
 * the same layering F7 gives a property value, because it is the same `props`
 * object. So `<Instance component="Button" />` asks for the default combination
 * with nothing said, which is what makes gaining a second state invisible to
 * every existing use.
 */
function askedCombination(
  instance: UidxNode,
  axes: ReadonlyMap<string, readonly string[]>,
): string {
  const asked = defaultCombination(axes)
  for (const [key, value] of instanceProps(instance).values) {
    if (typeof value === 'string' && axes.get(key)?.includes(value)) asked.set(key, value)
  }
  return variantName(asked)
}

export interface Reference {
  file: string
  /**
   * What kind of thing `target` names (story F6).
   *
   * `symbol` is the document's one global namespace — a token variable or a
   * component. `property` is a component property, which is scoped to the
   * component the reference sits inside and therefore is *not* in that
   * namespace at all. They share a syntax and are told apart by a fact about
   * addresses rather than by a sigil: a token's global name is its address and
   * always contains `#` (`radius#md`), so a bare `{label}` cannot be one.
   */
  kind: 'symbol' | 'property'
  /**
   * Whatever the edge runs *from*, in the same namespace as `target`.
   *
   * For a token alias that is the variable's own address, which is its global
   * name. For an `<Instance>` it is the name of the `<Component>` the instance
   * sits inside — not the instance's address — because that is what makes a
   * cycle close: "A contains an instance of B, which contains an instance of A"
   * is a loop only if both ends are spelled as component names. An instance
   * standing on a page outside any component keeps its own address here, which
   * nothing can target, so it is a source and never part of a loop.
   */
  from: string
  target: string
  /** The attribute the reference was written on, for the binding-fit check. */
  prop: string
  loc: { start: number; end: number }
  line: number
  column: number
}

/**
 * Every reference in the document: `{alias}` values, and `<Instance>`'s
 * `component` (story F3).
 *
 * One collector for both because ADR 0004 §2 gives them one namespace, and
 * because the two questions worth asking — does it resolve, does it close a
 * loop — are the same question for a token alias and for an instance. G4
 * deferred both on the grounds that `<Instance>` would be the first thing with
 * a reference syntax; token aliases got there first and built the machinery, so
 * this story adds edges rather than a second checker.
 */
export function collectReferences(pages: readonly PageSource[]): Reference[] {
  const out: Reference[] = []
  for (const { file, doc } of pages) {
    const walk = (node: UidxNode, owner: string | null, parentAddress: string): void => {
      /**
       * The address a reference out of this node belongs to.
       *
       * A `<Mode>` carries the empty address (G8), because it is a value
       * carrier rather than an entity — so an edge out of one would leave the
       * page root instead of the variable, and a cycle running through two
       * moded variables would close somewhere nothing is looking. The mode's
       * alias is the variable's alias; this says so.
       */
      const home = node.element === 'Mode' ? parentAddress : node.address

      for (const [prop, attr] of Object.entries(node.attrs)) {
        const target = aliasTarget(attr.value)
        if (target === null) continue
        const { line, column } = positionAt(doc.source, attr.valueLoc.start)
        const property = propertyBinding(target)
        out.push({
          file,
          kind: property === null ? 'symbol' : 'property',
          // A property binding runs from the component that must declare it,
          // which is the same "from" an instance edge uses and for the same
          // reason: it is the thing whose name resolves the target.
          from: property === null ? home : (owner ?? home),
          target,
          prop,
          loc: attr.valueLoc,
          line,
          column,
        })
      }

      if (node.element === 'Instance') {
        const attr = node.attrs.component
        // An `INSTANCE_SWAP` property fills this attribute (F6), and the loop
        // above has already reported it as a binding. Reading the raw value
        // here too emitted a second edge targeting the literal `"{icon}"`,
        // which resolves to nothing and reported a name the author never
        // wrote — caught by F6's own test, not by anything F3 had.
        if (
          attr &&
          typeof attr.value === 'string' &&
          attr.value !== '' &&
          aliasTarget(attr.value) === null
        ) {
          const { line, column } = positionAt(doc.source, attr.valueLoc.start)
          out.push({
            file,
            kind: 'symbol',
            from: owner ?? home,
            target: attr.value,
            prop: 'component',
            loc: attr.valueLoc,
            line,
            column,
          })
        }
      }

      // A `<Component>` on a page is what a name refers to, so it is where an
      // edge out of this subtree starts. Nothing nests below one that redefines
      // that, which is why the owner is carried down rather than recomputed.
      const inner = node.element === 'Component' ? node.name : owner
      for (const child of node.children) walk(child, inner, node.address)
    }
    walk(doc.tree, null, '')
  }
  return out
}

/**
 * Unresolved aliases and reference cycles (G4's deferred half, landing here).
 *
 * G4 pushed both to F3 on the reasoning that references need a syntax and
 * `<Instance>` would be the first to have one. Token aliases got there first —
 * a `<Variable>` whose value is `{other#token}` is a reference, and a chain of
 * them can close a loop — so the machinery is built against real edges rather
 * than a guess, which is what that deferral was protecting.
 */
function checkReferences(
  pages: readonly PageSource[],
  table: SymbolTable,
): (Diagnostic & { file: string })[] {
  const out: (Diagnostic & { file: string })[] = []
  const references = collectReferences(pages)
  const declarations = componentNodes(pages)

  // A FLOAT may carry a length. Follow every mode and alias so a token with
  // a numeric default cannot put a rem string into opacity in another mode.
  const lengthTokens = new Set<string>()
  const tokenAliases = new Map<string, string[]>()
  for (const { doc } of pages) {
    if (doc.tree.element !== 'Tokens') continue
    for (const collection of doc.tree.children)
      for (const variable of collection.children) {
        if (variable.attrs.type?.value !== 'FLOAT') continue
        const values = variable.children.length
          ? variable.children.map((mode) => mode.attrs.value?.value)
          : [variable.attrs.value?.value]
        if (values.some(isUnitLength)) lengthTokens.add(variable.address)
        tokenAliases.set(
          variable.address,
          values.flatMap((value) => {
            const target = value === undefined ? null : aliasTarget(value)
            return target === null ? [] : [target]
          }),
        )
      }
  }
  const aliasesOf = new Map<string, string[]>()
  for (const [address, targets] of tokenAliases)
    for (const target of targets) {
      const sources = aliasesOf.get(target) ?? []
      sources.push(address)
      aliasesOf.set(target, sources)
    }
  const queue = [...lengthTokens]
  for (let i = 0; i < queue.length; i++) {
    for (const address of aliasesOf.get(queue[i]!) ?? [])
      if (!lengthTokens.has(address)) {
        lengthTokens.add(address)
        queue.push(address)
      }
  }

  for (const reference of references) {
    if (reference.kind === 'property') {
      out.push(...checkPropertyBinding(reference, declarations))
      continue
    }
    if (UNITLESS_NUMBER_PROPS.has(reference.prop) && lengthTokens.has(reference.target)) {
      out.push({
        file: reference.file,
        code: CODES.BAD_LENGTH,
        severity: 'error',
        message: `${reference.prop} does not accept length units from "${reference.target}"`,
        loc: reference.loc,
        line: reference.line,
        column: reference.column,
      })
    }
    if (table.get(reference.target)) continue
    const near = table.suggest(reference.target)
    out.push({
      file: reference.file,
      code: WORKSPACE_CODES.UNRESOLVED_REFERENCE,
      message:
        `"${reference.target}" does not resolve to anything in this document` +
        (near.length ? `. Did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : ''),
      severity: 'error',
      loc: reference.loc,
      line: reference.line,
      column: reference.column,
    })
  }

  /**
   * A binding to a variable the property's scope does not cover (story G8).
   *
   * A **warning**, deliberately. Figma's scopes only filter its picker — its
   * API binds regardless — so a hard error would make the file stricter than
   * the tool it mirrors, and would refuse to open a document that arrived by
   * import. Absent scopes mean `ALL_SCOPES`, so a variable that states nothing
   * is never in violation.
   */
  for (const reference of references) {
    if (reference.kind !== 'symbol') continue
    const wanted = scopesForProp(reference.prop)
    if (!wanted) continue
    const scopes = table.get(reference.target)?.variableScopes
    if (!scopes || scopes.includes('ALL_SCOPES')) continue
    if (scopes.some((scope) => wanted.includes(scope))) continue
    out.push({
      file: reference.file,
      code: WORKSPACE_CODES.SCOPE_VIOLATION,
      message:
        `"${reference.target}" is not scoped for ${reference.prop} ` +
        `(it allows ${scopes.join(', ')})`,
      severity: 'warning',
      loc: reference.loc,
      line: reference.line,
      column: reference.column,
    })
  }

  /**
   * An alias takes its target's type, so the two must agree (story G8).
   *
   * Checkable without a mode tuple: a variable has exactly one type across
   * every mode, and only its *values* vary by mode. So an alias declared inside
   * a `<Mode>` is checked the same way a bare one is — which is why this sits
   * beside the unresolved-reference pass rather than inside the renderer.
   */
  for (const reference of references) {
    if (reference.kind !== 'symbol') continue
    const source = table.get(reference.from)
    const target = table.get(reference.target)
    if (!source?.variableType || !target?.variableType) continue
    if (source.variableType === target.variableType) continue
    out.push({
      file: reference.file,
      code: WORKSPACE_CODES.ALIAS_TYPE_MISMATCH,
      message:
        `"${reference.from}" is ${source.variableType} but ` +
        `"${reference.target}" is ${target.variableType}`,
      severity: 'error',
      loc: reference.loc,
      line: reference.line,
      column: reference.column,
    })
  }

  // Edges only between things that resolve, so a cycle report never piles onto
  // an unresolved-reference report for the same alias. Property bindings are
  // absent by construction: a property is not a node, so it cannot be on a
  // path back to anything.
  const edges = new Map<string, Reference[]>()
  for (const reference of references) {
    if (reference.kind !== 'symbol') continue
    if (!table.get(reference.target)) continue
    const list = edges.get(reference.from)
    if (list) list.push(reference)
    else edges.set(reference.from, [reference])
  }

  for (const cycle of findCycles(edges)) {
    const head = cycle.at(-1)!
    out.push({
      file: head.file,
      code: WORKSPACE_CODES.REFERENCE_CYCLE,
      message: `reference cycle: ${cycle.map((r) => r.from).join(' → ')} → ${head.target}`,
      severity: 'error',
      loc: head.loc,
      line: head.line,
      column: head.column,
    })
  }

  return out
}

/**
 * Every `<Component>` in the document, by global name (ADR 0004 §2).
 *
 * The node rather than what it declares, because two checks want two different
 * facts about it — F6's property list and F8's variant axes — and walking the
 * document twice to answer one question each is how the two would drift.
 */
function componentNodes(pages: readonly PageSource[]): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const { doc } of pages) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element === 'Component' && !out.has(node.name)) out.set(node.name, node)
    }
  }
  return out
}

/**
 * A `{label}` binding, checked against the component it sits inside (F6).
 *
 * Three ways it can be wrong, and they want three different sentences: the
 * binding is not inside a component at all, the component declares no such
 * property, or it declares one whose type cannot fill this attribute. The last
 * is the one nothing else would catch — a `TEXT` property bound to `visible`
 * renders a string where a boolean belongs, and the renderer gets the blame.
 */
function checkPropertyBinding(
  reference: Reference,
  declarations: Map<string, UidxNode>,
): (Diagnostic & { file: string })[] {
  const at = {
    file: reference.file,
    severity: 'error' as const,
    loc: reference.loc,
    line: reference.line,
    column: reference.column,
  }
  const component = declarations.get(reference.from)
  if (!component) {
    return [
      {
        ...at,
        code: WORKSPACE_CODES.UNRESOLVED_REFERENCE,
        message:
          `"{${reference.target}}" reads a component property, but this is not inside a ` +
          `<Component>. ${BINDING_RULE}`,
      },
    ]
  }

  const declared = componentProps(component).declared
  const declaration = declared.get(reference.target)
  if (!declaration) {
    const near = suggest(reference.target, [...declared.keys()])
    return [
      {
        ...at,
        code: WORKSPACE_CODES.UNRESOLVED_REFERENCE,
        message:
          `"${reference.from}" declares no property "${reference.target}"` +
          (near.length ? `. Did you mean ${near.map((n) => `"${n}"`).join(', ')}?` : '') +
          (declared.size === 0 ? `. ${BINDING_RULE}` : ''),
      },
    ]
  }

  if (bindingFits(declaration.type, reference.prop)) return []
  return [
    {
      ...at,
      code: WORKSPACE_CODES.PROPERTY_BINDING_MISMATCH,
      message:
        `"${reference.target}" is ${declaration.type}, which fills ` +
        `"${PROPERTY_FIELD[declaration.type]}" — not "${reference.prop}"`,
    },
  ]
}

/** DFS over the reference graph, reporting each distinct cycle once. */
function findCycles(edges: Map<string, Reference[]>): Reference[][] {
  const cycles: Reference[][] = []
  const seen = new Set<string>()
  const settled = new Set<string>()
  const reported = new Set<string>()
  const stack: Reference[] = []

  const visit = (node: string): void => {
    if (settled.has(node)) return
    seen.add(node)
    for (const edge of edges.get(node) ?? []) {
      stack.push(edge)
      if (seen.has(edge.target)) {
        const at = stack.findIndex((r) => r.from === edge.target)
        const cycle = stack.slice(at === -1 ? 0 : at)
        // Rotation-independent key, so A→B→A is not reported twice.
        const key = [...cycle.map((r) => r.from)].sort().join('|')
        if (!reported.has(key)) {
          reported.add(key)
          cycles.push(cycle)
        }
      } else {
        visit(edge.target)
      }
      stack.pop()
    }
    seen.delete(node)
    settled.add(node)
  }

  for (const node of edges.keys()) visit(node)
  return cycles
}

/**
 * Near matches for an unresolved name.
 *
 * Global naming costs the diagnostic a hint — "not found" cannot say which file
 * it should have been in (ADR 0004), so the suggestion carries more weight here
 * than it would in a scoped language. Shared with story E3.
 */
export function suggest(name: string, candidates: readonly string[], limit = 3): string[] {
  const budget = Math.max(2, Math.floor(name.length / 3))
  return candidates
    .map((candidate) => ({
      candidate,
      score: distance(name.toLowerCase(), candidate.toLowerCase()),
    }))
    .filter((entry) => entry.score <= budget)
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map((entry) => entry.candidate)
}

/** Levenshtein, two rows rather than a full matrix. */
function distance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost)
    }
    previous = current
  }
  return previous[b.length]!
}
