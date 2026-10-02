import {
  parse,
  STATE_AXIS,
  type BehaviorRule,
  type ContractSpec,
  type ExampleSpec,
  type JsonValue,
  type UidxDocument,
} from '@uidx/format'
import type { DependentsIndex } from '@uidx/schema'

/**
 * What a component's documentation page shows (the Docs face): the words, the
 * contract, the behaviour rules and the examples of one identity, read from
 * its file and nothing else. The canvas shows what a component looks like;
 * this shows what it *is*, for the designer, developer or reviewer who never
 * opens the file.
 *
 * Pure, so the page's shape is tested without mounting anything.
 */
export interface ComponentDocs {
  file: string
  name: string
  status: string | null
  implements: string | null
  /** The Markdown above `## Visual Contract`, trimmed; empty when there is none. */
  intent: string
  contract: ContractSpec | null
  behavior: BehaviorRule[]
  examples: DocsExample[]
  /** Where the component is used: one entry per instance, file first. */
  usedIn: { file: string; address: string }[]
}

export interface DocsExample {
  name: string
  /** The instance's `props`, from the example's `<Set>`s. */
  props: Record<string, JsonValue>
  /** `<Set>`s the page cannot draw as one instance, said rather than dropped. */
  notDrawn: string[]
}

export function componentDocs(
  file: string,
  doc: UidxDocument,
  deps: DependentsIndex,
): ComponentDocs | null {
  const component = doc.tree.children.find((node) => node.element === 'Component')
  if (!component) return null
  const contract = doc.spec?.contract ?? null
  const text = (name: string): string | null => {
    const value = component.attrs[name]?.value
    return typeof value === 'string' && value !== '' ? value : null
  }
  return {
    file,
    name: component.name,
    status: text('status'),
    implements: text('implements'),
    intent: intentText(doc.intent.raw),
    contract,
    behavior: doc.spec?.behavior ?? [],
    examples: (doc.spec?.examples ?? []).map((example) => docsExample(example, contract)),
    usedIn: (deps.ofComponent.get(component.name) ?? [])
      .map((dependent) => ({ file: dependent.file, address: dependent.address }))
      .sort((a, b) => a.file.localeCompare(b.file) || a.address.localeCompare(b.address)),
  }
}

/** The intent without the `## Core Intent`-style heading a starter page carries. */
function intentText(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => !/^#{1,6}\s/.test(line))
    .join('\n')
    .trim()
}

/**
 * An example as one instance (ADR 0015 §3): `at="root" state="…"` chooses the
 * state — a visual boolean prop set true, any other name the `state` axis —
 * and `at="<prop>" value={…}` sets a contract prop. Counts and per-row
 * overrides need the rows themselves, and are listed as not drawn.
 */
export function docsExample(example: ExampleSpec, contract: ContractSpec | null): DocsExample {
  const props: Record<string, JsonValue> = {}
  const notDrawn: string[] = []
  const booleans = new Set(
    (contract?.props ?? [])
      .filter((prop) => prop.visual && prop.type === 'boolean')
      .map((prop) => prop.name),
  )
  const declared = new Set((contract?.props ?? []).map((prop) => prop.name))
  for (const set of example.sets) {
    if (set.at === 'root' && set.state !== undefined) {
      if (booleans.has(set.state)) props[set.state] = true
      else props[STATE_AXIS] = set.state
      continue
    }
    if (set.at !== undefined && declared.has(set.at) && set.value !== undefined) {
      props[set.at] = set.value
      continue
    }
    notDrawn.push(describeSet(set))
  }
  return { name: example.name, props, notDrawn }
}

function describeSet(set: ExampleSpec['sets'][number]): string {
  const parts: string[] = []
  if (set.slot !== undefined) parts.push(`slot="${set.slot}"`)
  if (set.at !== undefined) parts.push(`at="${set.at}"`)
  if (set.count !== undefined) parts.push(`count={${set.count}}`)
  if (set.state !== undefined) parts.push(`state="${set.state}"`)
  if (set.value !== undefined) parts.push(`value={${JSON.stringify(set.value)}}`)
  return `<Set ${parts.join(' ')} />`
}

/**
 * A one-instance page drawing an example, for the thumbnailer — which takes
 * any document, so an example is drawn by the same renderer as the canvas.
 */
export function exampleDocument(component: string, example: DocsExample): UidxDocument | null {
  const props = Object.keys(example.props).length ? ` props={${JSON.stringify(example.props)}}` : ''
  const source = `---\nid: example\n---\n\n## Visual Contract\n\n<Page>\n  <Instance name="example" component=${JSON.stringify(component)}${props} />\n</Page>\n`
  return parse(source).doc
}
