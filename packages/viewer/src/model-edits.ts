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

/* ---------------------------------------------------------------- items */

/**
 * A model's content as items — one row per item, one cell per field — the
 * way a designer manages it, stored the way the file already holds it: one
 * sample list per field, the n-th entries of every list being the n-th item
 * (ADR 0015 §2). A field with a single value gives it to every item.
 */
export type Item = Record<string, JsonValue | undefined>

/** Fields an item table shows: values, not other models (those are their own items). */
export const itemFields = (model: { fields: readonly FieldSpec[] }): FieldSpec[] =>
  model.fields.filter((field) => !/^[A-Z]/.test(field.type.trim()))

/** How many items a model holds: its longest sample list; one for single values; none at all. */
export function itemCount(model: { fields: readonly FieldSpec[] }): number {
  let count = 0
  for (const field of model.fields) {
    if (Array.isArray(field.sample)) count = Math.max(count, field.sample.length)
    else if (field.sample !== undefined) count = Math.max(count, 1)
  }
  return count
}

export function itemsOf(model: { fields: readonly FieldSpec[] }): Item[] {
  const count = itemCount(model)
  return Array.from({ length: count }, (_, index) => {
    const item: Item = {}
    for (const field of model.fields) item[field.name] = cellOf(field, index)
    return item
  })
}

function cellOf(field: FieldSpec, index: number): JsonValue | undefined {
  if (Array.isArray(field.sample)) return field.sample[index]
  return field.sample
}

/** A field's samples as a list of exactly `count` entries, so one item can change alone. */
function column(field: FieldSpec, count: number): JsonValue[] {
  return Array.from({ length: count }, (_, index) => cellOf(field, index) ?? null)
}

/** An empty cell of a field's type: text empty, numbers zero, flags off, the rest absent. */
function blank(field: FieldSpec): JsonValue {
  const type = field.type.trim()
  if (type === 'number') return 0
  if (type === 'boolean') return false
  if (type === 'string' || type === 'image' || type === 'date') return ''
  return null
}

const write = (model: ModelSpec, field: FieldSpec, sample: JsonValue[]): UidxPatch[] =>
  setField(model.name, field.name, fieldWith(field, { sample }))

/** One cell of one item, written as its field's list. */
export function setItemCell(
  model: ModelSpec,
  fieldName: string,
  index: number,
  value: JsonValue,
): UidxPatch[] {
  const field = model.fields.find((candidate) => candidate.name === fieldName)
  if (!field) return []
  const count = Math.max(itemCount(model), index + 1)
  const sample = column(field, count)
  sample[index] = value
  return write(model, field, sample)
}

/** A new item at the end: blank cells, and a fresh value in the key field so rows stay keyed. */
export function addItem(model: ModelSpec): UidxPatch[] {
  const count = itemCount(model)
  const fields = itemFields(model)
  return fields.flatMap((field) => {
    const sample = column(field, count)
    sample.push(field.key ? `${model.name.toLowerCase()}-${count + 1}` : blank(field))
    return write(model, field, sample)
  })
}

export function removeItem(model: ModelSpec, index: number): UidxPatch[] {
  const count = itemCount(model)
  if (index < 0 || index >= count) return []
  return itemFields(model).flatMap((field) => {
    const sample = column(field, count)
    sample.splice(index, 1)
    return write(model, field, sample)
  })
}
