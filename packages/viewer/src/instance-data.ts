import type { ModelSpec, UidxDocument, UidxNode } from '@uidx/format'
import { modelOfType, sampleAt, type ModelIndex } from '@uidx/schema'
import { contractView, type ReceiveRow } from './contract-edits'
import { fillContext } from './slot-content'

/**
 * The Data group of the instance inspector: what each contract prop of the
 * instance's component receives here (ADR 0013, ADR 0017 §2).
 *
 * Builder's "Data" tab answers the same question for a block — where does
 * this value come from — and the answer differs by where the instance sits:
 *
 * - filling a list's repeated slot, the list hands each copy its own item;
 * - inside another component, an enclosing repeat's item or the component's
 *   own prop, which the use may choose (the Contract tab's Receives rows);
 * - on a page, the model's sample data, which the canvas previews one row
 *   of at a time.
 */
export type DataSource =
  | { kind: 'item'; owner: string; ownerAddress: string; list: string }
  | { kind: 'receives'; row: ReceiveRow }
  | { kind: 'samples'; count: number }
  | { kind: 'sample'; index: number; count: number; label: string }
  | { kind: 'none' }

export interface DataRow {
  prop: string
  type: string
  /** The model the type names, for the link to its declaration. */
  model: string | null
  source: DataSource
}

/** How many distinct rows a model's samples give: the longest sample list. */
export function sampleCount(model: ModelSpec): number {
  return Math.max(
    1,
    ...model.fields.map((field) => (Array.isArray(field.sample) ? field.sample.length : 1)),
  )
}

/** One row of samples in a few words: its name-like field, else its first text. */
export function sampleLabel(model: ModelSpec, index: number): string {
  const named =
    model.fields.find((field) => /^(name|title|label|heading)$/i.test(field.name)) ??
    model.fields.find((field) => typeof sampleAt(field, index) === 'string' && !field.key)
  const value = named ? sampleAt(named, index) : undefined
  return typeof value === 'string' && value ? value : `Row ${index + 1}`
}

export function dataRows(
  doc: UidxDocument | null,
  instance: UidxNode,
  definition: UidxNode | undefined,
  components: ReadonlyMap<string, UidxNode> | undefined,
  models: ModelIndex | undefined,
  previewIndex: number,
): DataRow[] {
  const props = definition?.spec?.contract?.props ?? []
  if (!definition || !props.length) return []
  const filling = doc ? fillContext(doc.tree, instance.address, components, models) : null
  const view = contractView(doc, instance, null, models, components)
  const inside = view.kind === 'instance' && view.component !== null
  return props.map((prop) => {
    const found = modelOfType(prop.type, definition.spec, models)
    const model = found?.model.name ?? null
    const base = { prop: prop.name, type: prop.type, model }
    if (filling?.repeat?.model && found && !found.list && model === filling.repeat.model)
      return {
        ...base,
        source: {
          kind: 'item' as const,
          owner: filling.owner.name,
          ownerAddress: filling.owner.address,
          list: filling.repeat.list,
        },
      }
    if (inside && view.kind === 'instance') {
      const row = view.receives.find((candidate) => candidate.prop === prop.name)
      if (row) return { ...base, source: { kind: 'receives' as const, row } }
    }
    if (found?.list)
      return { ...base, source: { kind: 'samples', count: sampleCount(found.model) } }
    if (found) {
      const count = sampleCount(found.model)
      const index = previewIndex % count
      return {
        ...base,
        source: { kind: 'sample', index, count, label: sampleLabel(found.model, index) },
      }
    }
    return { ...base, source: { kind: 'none' } }
  })
}

/** A component's own model props, which its page previews with one sample row. */
export function previewModel(
  component: UidxNode | undefined,
  models: ModelIndex | undefined,
): { prop: string; model: ModelSpec } | null {
  for (const prop of component?.spec?.contract?.props ?? []) {
    const found = modelOfType(prop.type, component?.spec, models)
    if (found && !found.list) return { prop: prop.name, model: found.model }
  }
  return null
}
