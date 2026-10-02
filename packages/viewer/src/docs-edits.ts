import {
  enumValues,
  regionBody,
  serializeValue,
  stateAxis,
  type ContractSpec,
  type JsonValue,
  type UidxDocument,
  type UidxPatch,
} from '@uidx/format'

/**
 * The Docs face's writes, built pure: the intent, the behaviour rules and the
 * examples, each turned back into the text its region holds and sent as one
 * `intent` or `region` op. The parser checks what lands; these check first,
 * so a mistake is said in the editor instead of as a refusal from the server.
 */

export interface RuleDraft {
  id: string
  text: string
}

/** A rule id: lower-case words joined by dashes, as `uidx check` reads them. */
export const RULE_ID = /^[a-z][a-z0-9-]*$/

/** The rules as written: from the source, so `code` marks the parsed text drops survive. */
export function rulesOf(doc: UidxDocument): RuleDraft[] {
  return (doc.spec?.behavior ?? []).map((rule) => {
    const written = doc.source
      .slice(rule.loc.start, rule.loc.end)
      .replace(/^\s*[-*+]\s+/, '')
      .replace(/\s+/g, ' ')
      .trim()
    const colon = written.indexOf(':')
    const text = colon === -1 ? rule.text : written.slice(colon + 1).trim()
    return { id: rule.id, text: text || rule.text }
  })
}

/** What is wrong with the rules as drafted, or null when they can be written. */
export function ruleProblem(rules: readonly RuleDraft[]): string | null {
  const seen = new Set<string>()
  for (const [index, rule] of rules.entries()) {
    const id = rule.id.trim()
    if (!RULE_ID.test(id))
      return `Rule ${index + 1}: an id is lower-case words joined by dashes, like "press" or "focus-ring"`
    if (seen.has(id)) return `Two rules are called "${id}"`
    seen.add(id)
    if (!rule.text.trim()) return `Rule "${id}" needs a sentence saying what happens`
  }
  return null
}

export function behaviorPatch(rules: readonly RuleDraft[]): UidxPatch {
  const body = rules
    .map((rule) => `- ${rule.id.trim()}: ${rule.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n')
  return body ? { op: 'region', name: 'Behavior', body } : { op: 'region', name: 'Behavior' }
}

/** One `<Set>`: a prop or axis given a value (`at`), or a slot filled (`slot`, `count`). */
export interface SetDraft {
  at?: string
  value?: JsonValue
  slot?: string
  count?: number
  state?: string
}

export interface ExampleDraft {
  name: string
  sets: SetDraft[]
}

export function examplesOf(doc: UidxDocument): ExampleDraft[] {
  return (doc.spec?.examples ?? []).map((example) => ({
    name: example.name,
    sets: example.sets.map(({ loc: _loc, ...set }) => {
      void _loc
      return { ...set }
    }),
  }))
}

/** What an example can set: each contract prop, and the state axis when there is one. */
export interface SetChoice {
  name: string
  kind: 'choice' | 'boolean' | 'number' | 'text'
  values?: string[]
}

export function setChoices(doc: UidxDocument): SetChoice[] {
  const contract: ContractSpec | undefined = doc.spec?.contract
  const out: SetChoice[] = (contract?.props ?? []).map((prop) => {
    const values = enumValues(prop.type)
    if (values) return { name: prop.name, kind: 'choice', values }
    if (prop.type === 'boolean') return { name: prop.name, kind: 'boolean' }
    if (prop.type === 'number') return { name: prop.name, kind: 'number' }
    return { name: prop.name, kind: 'text' }
  })
  const states = stateAxis(contract, doc.spec?.styles ?? [])
  if (states.length > 1 && !out.some((choice) => choice.name === 'state'))
    out.push({ name: 'state', kind: 'choice', values: states })
  return out
}

export function exampleProblem(examples: readonly ExampleDraft[]): string | null {
  const seen = new Set<string>()
  for (const [index, example] of examples.entries()) {
    const name = example.name.trim()
    if (!name) return `Example ${index + 1} needs a name`
    if (seen.has(name)) return `Two examples are called "${name}"`
    seen.add(name)
    for (const set of example.sets) {
      if (!set.at && !set.slot) return `Example "${name}": each row sets a property or fills a slot`
      if (set.at && set.value === undefined) return `Example "${name}": give ${set.at} a value`
    }
  }
  return null
}

const SET_ORDER = ['slot', 'at', 'state', 'count', 'value'] as const

export function examplesPatch(examples: readonly ExampleDraft[]): UidxPatch {
  const body = examples
    .map((example) => {
      const sets = example.sets.map((set) => {
        const attrs = SET_ORDER.filter((key) => set[key] !== undefined).map(
          (key) => `${key}=${serializeValue(set[key] as JsonValue)}`,
        )
        return `  <Set ${attrs.join(' ')} />`
      })
      const name = `name=${serializeValue(example.name.trim())}`
      return sets.length
        ? `<Example ${name}>\n${sets.join('\n')}\n</Example>`
        : `<Example ${name} />`
    })
    .join('\n\n')
  return body ? { op: 'region', name: 'Examples', body } : { op: 'region', name: 'Examples' }
}

/** The intent as written, for the editor: the Markdown above the visual contract. */
export function intentOf(doc: UidxDocument): string {
  return doc.intent.raw.trim()
}

/** The examples region verbatim, for a file whose examples the form cannot show. */
export function examplesText(doc: UidxDocument): string {
  return regionBody(doc, 'Examples') ?? ''
}
