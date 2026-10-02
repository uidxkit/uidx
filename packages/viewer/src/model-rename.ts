import {
  declarationOf,
  fieldDeclarationOf,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

/** A model or field name: a bare identifier, as a type or a binding reads it. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

type Plan = { byFile: Map<string, UidxPatch[]> } | { refused: string }

/** `Contact`, `Contact[]` and `Contact | null` all name Contact; rewrite only whole words. */
function retype(type: string | undefined, from: string, to: string): string | null {
  if (!type) return null
  const next = type.replace(new RegExp(`\\b${from}\\b`, 'g'), to)
  return next === type ? null : next
}

function batches(): { byFile: Map<string, UidxPatch[]>; batch: (file: string) => UidxPatch[] } {
  const byFile = new Map<string, UidxPatch[]>()
  return {
    byFile,
    batch: (file) => {
      const list = byFile.get(file) ?? []
      byFile.set(file, list)
      return list
    },
  }
}

function declaringModel(
  pages: ReadonlyMap<string, UidxDocument>,
  name: string,
): { file: string; doc: UidxDocument } | null {
  for (const [file, doc] of pages)
    if (doc.spec?.models?.some((model) => model.name === name)) return { file, doc }
  return null
}

/**
 * Renames a model (ADR 0015 §1) and every type that names it: contract props
 * (`Contact`, `Contact[]`) and fields of other models, on every page.
 */
export function renameModel(
  pages: ReadonlyMap<string, UidxDocument>,
  from: string,
  to: string,
): Plan {
  const name = to.trim()
  const found = declaringModel(pages, from)
  if (!found) return { refused: `there is no model ${from}` }
  if (!IDENTIFIER.test(name)) return { refused: 'a model name is one word, like Contact' }
  if (declaringModel(pages, name)) return { refused: `there is already a model called ${name}` }
  const model = found.doc.spec!.models!.find((entry) => entry.name === from)!
  const { byFile, batch } = batches()
  batch(found.file).push({
    op: 'model',
    name: from,
    declaration: { description: model.description },
    rename: name,
  })
  for (const [file, doc] of pages) {
    for (const prop of doc.spec?.contract?.props ?? []) {
      const type = retype(prop.type, from, name)
      const declaration = type ? declarationOf(doc, 'prop', prop.name) : undefined
      if (type && declaration)
        batch(file).push({
          op: 'contract',
          kind: 'prop',
          name: prop.name,
          declaration: { ...declaration, attrs: { ...declaration.attrs, type } },
        })
    }
    for (const other of doc.spec?.models ?? []) {
      for (const field of other.fields) {
        const type = retype(field.type, from, name)
        if (!type) continue
        const declaration = fieldDeclarationOf(field)
        batch(file).push({
          op: 'field',
          // The renamed model's own self-references are written after its rename.
          model: other.name === from ? name : other.name,
          name: field.name,
          declaration: { ...declaration, attrs: { ...declaration.attrs, type } },
        })
      }
    }
  }
  return { byFile }
}

/**
 * Renames a field in place and carries the bindings that read it: `{item.old}`
 * under a repeat over a list of this model, and `{prop.old}` for a prop typed
 * by it, inside every component that receives the model.
 */
export function renameField(
  pages: ReadonlyMap<string, UidxDocument>,
  model: string,
  from: string,
  to: string,
): Plan {
  const name = to.trim()
  const found = declaringModel(pages, model)
  const field = found?.doc.spec?.models
    ?.find((entry) => entry.name === model)
    ?.fields.find((entry) => entry.name === from)
  if (!found || !field) return { refused: `${model} has no field ${from}` }
  if (!IDENTIFIER.test(name)) return { refused: 'a field name is one word, like email' }
  const { byFile, batch } = batches()
  batch(found.file).push({
    op: 'field',
    model,
    name: from,
    declaration: fieldDeclarationOf(field),
    rename: name,
  })
  for (const [file, doc] of pages) {
    const component = doc.tree.children.find((node) => node.element === 'Component')
    if (!component) continue
    const typed = (doc.spec?.contract?.props ?? []).filter((prop) =>
      new RegExp(`\\b${model}\\b`).test(prop.type ?? ''),
    )
    if (!typed.length) continue
    // What a binding may start with: a prop of this type, or a repeat's item over a list of them.
    const heads = new Set<string>(typed.map((prop) => prop.name))
    const lists = new Set(
      typed.filter((prop) => prop.type?.includes('[]')).map((prop) => prop.name),
    )
    const walk = (node: UidxNode): void => {
      const repeat = node.attrs.repeat?.value
      if (typeof repeat === 'string' && lists.has(repeat.replace(/^\{|\}$/g, ''))) {
        const as = node.attrs.as?.value
        heads.add(typeof as === 'string' ? as : 'item')
      }
      node.children.forEach(walk)
    }
    walk(component)
    const rewrite = (value: JsonValue): JsonValue => {
      if (typeof value === 'string')
        return value.replace(
          /\{([A-Za-z_]\w*)\.([A-Za-z_]\w*)\}/g,
          (whole, head: string, key: string) =>
            heads.has(head) && key === from ? `{${head}.${name}}` : whole,
        )
      if (Array.isArray(value)) return value.map(rewrite)
      if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v)]))
      return value
    }
    const visit = (node: UidxNode): void => {
      for (const [prop, attr] of Object.entries(node.attrs)) {
        const next = rewrite(attr.value)
        if (JSON.stringify(next) !== JSON.stringify(attr.value))
          batch(file).push({ op: 'set', address: node.address, prop, value: next })
      }
      node.children.forEach(visit)
    }
    component.children.forEach(visit)
  }
  return { byFile }
}
