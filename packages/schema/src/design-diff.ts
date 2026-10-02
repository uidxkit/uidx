import type { ContractSpec, JsonValue, UidxDocument, UidxNode } from '@uidx/format'

import { componentBox, derivesVariants, type ContractBox } from './design-system.js'
import { buildTokenIndex } from './token-index.js'

/**
 * What changed in a design system between two versions of its document, as
 * a reviewer and a release need it (ADR 0013, "removing or renaming a Prop,
 * Event or Slot is a breaking change"): component contracts, models and
 * tokens, each change marked breaking or not, and where a use's outer box
 * lands (ADR 0018).
 *
 * Pure: two sets of parsed pages in, a list of changes out.
 */
export interface DesignChange {
  breaking: boolean
  /** `Button`, `model Contact`, `token color#accent`. */
  subject: string
  change: string
}

type Pages = ReadonlyMap<string, UidxDocument>

function contracts(pages: Pages): Map<string, ContractSpec | undefined> {
  const out = new Map<string, ContractSpec | undefined>()
  for (const doc of pages.values())
    for (const node of doc.tree.children)
      if (node.element === 'Component') out.set(node.name, doc.spec?.contract)
  return out
}

function components(pages: Pages): Map<string, UidxNode> {
  const out = new Map<string, UidxNode>()
  for (const doc of pages.values())
    for (const node of doc.tree.children) if (node.element === 'Component') out.set(node.name, node)
  return out
}

/**
 * Where a use's box lands, as a reviewer would name it. A styles table's
 * `root` carries the component's own attributes, so it is the component
 * itself as much as the undivided component is: adding the first style row
 * moves nothing a use can see.
 */
function boxPlace(component: UidxNode, box: ContractBox): string {
  if (box.target === 'self' || derivesVariants(component)) return 'the component itself'
  if (box.target === 'frame') return `frame "${box.node}"`
  return `instance "${box.node}"${box.component ? ` of ${box.component}` : ''}`
}

function models(pages: Pages) {
  const out = new Map<string, Map<string, { type: string; optional: boolean }>>()
  for (const doc of pages.values())
    for (const model of doc.spec?.models ?? [])
      out.set(
        model.name,
        new Map(
          model.fields.map((field) => [field.name, { type: field.type, optional: field.optional }]),
        ),
      )
  return out
}

const show = (value: JsonValue | undefined): string =>
  value === undefined ? 'nothing' : JSON.stringify(value)

export function designDiff(before: Pages, after: Pages): DesignChange[] {
  const changes: DesignChange[] = []
  const add = (breaking: boolean, subject: string, change: string) =>
    changes.push({ breaking, subject, change })

  const was = contracts(before)
  const now = contracts(after)
  const wasNodes = components(before)
  const nowNodes = components(after)
  for (const [name, old] of was) {
    if (!now.has(name)) {
      add(true, name, 'component removed')
      continue
    }
    const next = now.get(name)
    const lists = [
      ['prop', old?.props ?? [], next?.props ?? []],
      ['event', old?.events ?? [], next?.events ?? []],
      ['slot', old?.slots ?? [], next?.slots ?? []],
      ['part', old?.parts ?? [], next?.parts ?? []],
      ['state', old?.states ?? [], next?.states ?? []],
    ] as const
    for (const [kind, oldList, newList] of lists) {
      const newNames = new Map<string, { name: string }>(
        newList.map((entry) => [entry.name, entry]),
      )
      for (const entry of oldList)
        if (!newNames.has(entry.name)) add(true, name, `${kind} "${entry.name}" removed`)
      const oldNames = new Set(oldList.map((entry) => entry.name))
      for (const entry of newList)
        if (!oldNames.has(entry.name)) {
          const required =
            kind === 'prop' &&
            (entry as { default?: JsonValue }).default === undefined &&
            !(entry as { type?: string }).type?.includes('undefined')
          add(false, name, `${kind} "${entry.name}" added${required ? ' (no default)' : ''}`)
        }
    }
    for (const prop of old?.props ?? []) {
      const next_ = next?.props.find((entry) => entry.name === prop.name)
      if (!next_) continue
      if ((prop.type ?? '') !== (next_.type ?? ''))
        add(true, name, `prop "${prop.name}" type ${prop.type} → ${next_.type}`)
      if (JSON.stringify(prop.default) !== JSON.stringify(next_.default))
        add(
          false,
          name,
          `prop "${prop.name}" default ${show(prop.default)} → ${show(next_.default)}`,
        )
    }
    // ADR 0018: a use still builds when its box moves or stops laying out,
    // so neither breaks. But a restyled use now paints another node, or its
    // padding does nothing, and the reviewer should hear which.
    const oldNode = wasNodes.get(name)!
    const newNode = nowNodes.get(name)!
    const oldBox = componentBox(oldNode, wasNodes)
    const newBox = componentBox(newNode, nowNodes)
    const from = boxPlace(oldNode, oldBox.box)
    const to = boxPlace(newNode, newBox.box)
    if (from !== to) add(false, name, `outer box moved from ${from} to ${to}`)
    if (oldBox.laysOut === true && newBox.laysOut === false)
      add(false, name, 'outer box no longer lays out, so padding on an instance does nothing')
  }
  for (const name of now.keys()) if (!was.has(name)) add(false, name, 'component added')

  const oldModels = models(before)
  const newModels = models(after)
  for (const [name, fields] of oldModels) {
    const next = newModels.get(name)
    if (!next) {
      add(true, `model ${name}`, 'removed')
      continue
    }
    for (const [field, info] of fields) {
      const nextField = next.get(field)
      if (!nextField) add(true, `model ${name}`, `field "${field}" removed`)
      else if (nextField.type !== info.type)
        add(true, `model ${name}`, `field "${field}" type ${info.type} → ${nextField.type}`)
    }
    for (const [field, info] of next)
      if (!fields.has(field))
        add(
          !info.optional,
          `model ${name}`,
          `field "${field}" added${info.optional ? '' : ' (required)'}`,
        )
  }
  for (const name of newModels.keys())
    if (!oldModels.has(name)) add(false, `model ${name}`, 'added')

  const oldTokens = buildTokenIndex([...before.values()]).entries
  const newTokens = buildTokenIndex([...after.values()]).entries
  for (const [address, entry] of oldTokens) {
    const next = newTokens.get(address)
    if (!next) {
      add(true, `token ${address}`, 'removed')
      continue
    }
    for (const [mode, value] of Object.entries(entry.valuesByMode)) {
      const nextValue = next.valuesByMode[mode]
      if (JSON.stringify(value) !== JSON.stringify(nextValue))
        add(false, `token ${address}`, `${mode}: ${show(value)} → ${show(nextValue)}`)
    }
    if (!entry.deprecated && next.deprecated) add(false, `token ${address}`, 'deprecated')
  }
  for (const address of newTokens.keys())
    if (!oldTokens.has(address)) add(false, `token ${address}`, 'added')
  return changes
}

/** The changes as the Markdown a pull-request comment carries. */
export function designDiffMarkdown(changes: readonly DesignChange[]): string {
  if (!changes.length) return '### Design system\n\nNo contract, model or token changes.\n'
  const breaking = changes.filter((change) => change.breaking)
  const rest = changes.filter((change) => !change.breaking)
  const lines = ['### Design system', '']
  if (breaking.length) {
    lines.push(`**${breaking.length} breaking change${breaking.length === 1 ? '' : 's'}**`, '')
    for (const change of breaking) lines.push(`- ⚠️ \`${change.subject}\`: ${change.change}`)
    lines.push('')
  }
  if (rest.length) {
    lines.push(`${rest.length} other change${rest.length === 1 ? '' : 's'}`, '')
    for (const change of rest) lines.push(`- \`${change.subject}\`: ${change.change}`)
    lines.push('')
  }
  return `${lines.join('\n')}`
}
