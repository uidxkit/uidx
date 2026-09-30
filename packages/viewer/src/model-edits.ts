import type {
  ContractDeclaration,
  FieldSpec,
  JsonValue,
  ModelSpec,
  UidxDocument,
  UidxPatch,
} from '@uidx/format'

/**
 * The Models face (ADR 0015 §1): every model of the document in one place,
 * the way the Tokens face gathers every collection.
 *
 * A model is declared once — on the page of the component that shows it, or
 * on a shared models page — and named by a prop's type wherever it is used,
 * so the face lists models across pages, says which page holds each and
 * which components receive it, and writes back through the `model` and
 * `field` ops to whichever page declares it. Pure, like the other edit
 * modules: the view is computed from the pages, every gesture is patches
 * for one file.
 */

export interface ModelUse {
  component: string
  file: string
  prop: string
  /** True for `Contact[]`: the component repeats over a list of them. */
  list: boolean
}

export interface ModelCard {
  name: string
  /** The page whose `## Models` declares it. */
  file: string
  description: string
  fields: FieldSpec[]
  usedBy: ModelUse[]
  /** Declared on the page the author has open. */
  onPage: boolean
}

/** What a prop's type names, stripped of the list marker: `Contact[]` → `Contact`. */
const typeName = (type: string): { name: string; list: boolean } => {
  const text = type.trim()
  return text.endsWith('[]')
    ? { name: text.slice(0, -2).trim(), list: true }
    : { name: text, list: false }
}

/** Every model of the document, the open page's first, then by page and name. */
export function modelsViewModel(
  pages: ReadonlyMap<string, UidxDocument>,
  current: string | null,
): ModelCard[] {
  const uses = new Map<string, ModelUse[]>()
  for (const [file, doc] of pages) {
    for (const node of doc.tree.children) {
      if (node.element !== 'Component') continue
      for (const prop of node.spec?.contract?.props ?? []) {
        const { name, list } = typeName(prop.type)
        const found = uses.get(name) ?? []
        found.push({ component: node.name, file, prop: prop.name, list })
        uses.set(name, found)
      }
    }
  }
  const cards: ModelCard[] = []
  for (const [file, doc] of pages) {
    for (const model of doc.spec?.models ?? []) {
      if (cards.some((card) => card.name === model.name)) continue
      cards.push({
        name: model.name,
        file,
        description: model.description,
        fields: model.fields,
        usedBy: uses.get(model.name) ?? [],
        onPage: file === current,
      })
    }
  }
  return cards.sort(
    (a, b) =>
      Number(b.onPage) - Number(a.onPage) ||
      a.file.localeCompare(b.file) ||
      a.name.localeCompare(b.name),
  )
}

/** Models a contract names that no page declares — the face offers to declare them. */
export function undeclaredModels(
  pages: ReadonlyMap<string, UidxDocument>,
): { name: string; file: string }[] {
  const declared = new Set<string>()
  for (const doc of pages.values())
    for (const model of doc.spec?.models ?? []) declared.add(model.name)
  const out: { name: string; file: string }[] = []
  for (const [file, doc] of pages) {
    for (const node of doc.tree.children) {
      if (node.element !== 'Component') continue
      for (const prop of node.spec?.contract?.props ?? []) {
        const { name } = typeName(prop.type)
        // A model is a capitalised name; `string`, `boolean`, `'a' | 'b'` are not.
        if (!/^[A-Z][A-Za-z0-9_]*$/.test(name) || declared.has(name)) continue
        if (!out.some((entry) => entry.name === name)) out.push({ name, file })
      }
    }
  }
  return out
}

/** A legal model or field name: a bare identifier. */
export const isIdentifier = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)

/**
 * Where a new model may go: every page, the open one first, and a page
 * called `models` — the shared models page ADR 0015 §1 allows — marked as
 * the suggestion when there is one.
 */
export function pagesForModels(
  pages: ReadonlyMap<string, UidxDocument>,
  current: string | null,
): { file: string; label: string; suggested: boolean }[] {
  return [...pages]
    .filter(([, doc]) => doc.tree.element !== 'Tokens')
    .map(([file, doc]) => ({
      file,
      label: String(doc.frontmatter.id ?? file),
      suggested: String(doc.frontmatter.id) === 'models' || /(^|\/)models\.uidx$/.test(file),
    }))
    .sort(
      (a, b) =>
        Number(b.file === current) - Number(a.file === current) ||
        Number(b.suggested) - Number(a.suggested) ||
        a.label.localeCompare(b.label),
    )
}

/* ------------------------------------------------------------ writes */

export const PLACEHOLDER = 'Describe '

export function addModel(name: string): UidxPatch[] {
  const trimmed = name.trim()
  if (!isIdentifier(trimmed)) return []
  return [
    {
      op: 'model',
      name: trimmed,
      declaration: { description: `${PLACEHOLDER}what one ${trimmed} carries.` },
    },
  ]
}

export function setModelDescription(name: string, description: string): UidxPatch[] {
  return [{ op: 'model', name, declaration: { description: description.trim() } }]
}

export function removeModel(name: string): UidxPatch[] {
  return [{ op: 'model', name }]
}

export function setField(
  model: string,
  name: string,
  declaration: ContractDeclaration,
): UidxPatch[] {
  if (!isIdentifier(name)) return []
  return [{ op: 'field', model, name, declaration }]
}

export function removeField(model: string, name: string): UidxPatch[] {
  return [{ op: 'field', model, name }]
}

/** A field as the op writes it back, with one attribute changed. */
export function fieldWith(
  field: FieldSpec,
  change: Partial<{
    type: string
    key: boolean
    optional: boolean
    sample: JsonValue | undefined
    description: string
  }>,
): ContractDeclaration {
  const next = {
    type: field.type,
    key: field.key,
    optional: field.optional,
    sample: field.sample,
    description: field.description,
    ...change,
  }
  const attrs: Record<string, JsonValue> = { type: next.type }
  if (next.key) attrs.key = true
  if (next.optional) attrs.optional = true
  if (next.sample !== undefined) attrs.sample = next.sample
  return { attrs, description: next.description }
}

/** `field`, `field-2`, … — the first name the model does not have. */
export function freshFieldName(model: { fields: readonly { name: string }[] }): string {
  const taken = new Set(model.fields.map((field) => field.name))
  if (!taken.has('field')) return 'field'
  for (let n = 2; ; n++) if (!taken.has(`field-${n}`)) return `field-${n}`
}

/** A new field: a string with a placeholder description, to be edited into shape. */
export function newField(model: ModelSpec): UidxPatch[] {
  return setField(model.name, freshFieldName(model), {
    attrs: { type: 'string' },
    description: `${PLACEHOLDER}the field.`,
  })
}

/**
 * A sample as typed: JSON where it parses (`["Ada", "Grace"]`, `3`, `null`),
 * the text otherwise, nothing for an empty field.
 */
export function parseSample(text: string): JsonValue | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  try {
    return JSON.parse(trimmed) as JsonValue
  } catch {
    return trimmed
  }
}

/** A sample as shown: a bare string as is, anything else as JSON. */
export function printSample(value: JsonValue | undefined): string {
  if (value === undefined) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}
