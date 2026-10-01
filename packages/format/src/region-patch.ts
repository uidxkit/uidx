import type MagicString from 'magic-string'

import { REGION_NAMES } from './spec.js'
import { PatchError } from './patch.js'
import { serializeValue } from './values.js'
import type { JsonValue, Range, UidxDocument, UidxPatch } from './types.js'

/**
 * The prose regions written whole (ADR 0012): `## Behavior` and `## Examples`
 * as text under their heading, and the intent above the visual contract.
 * Their structure is checked by the parser after the write, as every patch
 * is, so a malformed rule or example is refused rather than written.
 */
export type WholeRegion = 'Behavior' | 'Examples'

interface Span {
  /** Where the heading line starts. */
  start: number
  /** Where the text under the heading starts. */
  body: number
  /** Where the region ends: the next region heading, or the end of the file. */
  end: number
}

/** Every `## ` heading after the visual contract's, with where it starts. */
function regionHeadings(doc: UidxDocument): { name: string; start: number; lineEnd: number }[] {
  const source = doc.source
  const out: { name: string; start: number; lineEnd: number }[] = []
  const pattern = /^## +(.+?)[ \t]*$/gm
  let fence = false
  let lineStart = 0
  // Skip anything inside a fenced code block, where `## ` is not a heading.
  for (const line of source.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    if (!fence && lineStart >= doc.intent.loc.end) {
      pattern.lastIndex = 0
      const match = pattern.exec(line)
      if (match && match[1] !== 'Visual Contract')
        out.push({ name: match[1]!, start: lineStart, lineEnd: lineStart + line.length })
    }
    lineStart += line.length + 1
  }
  return out
}

function spanOf(doc: UidxDocument, name: string): Span | null {
  const headings = regionHeadings(doc)
  const index = headings.findIndex((heading) => heading.name === name)
  if (index === -1) return null
  const heading = headings[index]!
  return {
    start: heading.start,
    body: heading.lineEnd,
    end: headings[index + 1]?.start ?? doc.source.length,
  }
}

/** The text under a region's heading, trimmed; undefined when the file has no such region. */
export function regionBody(doc: UidxDocument, name: WholeRegion): string | undefined {
  const span = spanOf(doc, name)
  return span ? doc.source.slice(span.body, span.end).trim() : undefined
}

export function writeRegion(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'region' }>,
  eol: '\r\n' | '\n',
): Range {
  const source = doc.source
  const span = spanOf(doc, patch.name)
  const body = patch.body?.replace(/\r?\n/g, eol).trim()
  if (body === undefined || body === '') {
    if (!span) throw new PatchError(`there is no ## ${patch.name} to remove`)
    // The region and the blank lines before it go; what follows keeps its own.
    let from = span.start
    while (from > 0 && /\s/.test(source[from - 1]!)) from--
    const tail = span.end < source.length ? `${eol}${eol}` : eol
    s.overwrite(from, span.end, tail)
    return { start: from, end: from + tail.length }
  }
  const text = `## ${patch.name}${eol}${eol}${body}${eol}`
  if (span) {
    const replacement = span.end < source.length ? `${text}${eol}` : text
    s.overwrite(span.start, span.end, replacement)
    return { start: span.start, end: span.start + replacement.length }
  }
  // A new region goes before the first region that follows it in the canonical
  // order (Contract, Behavior, Models, Examples), or at the end of the file.
  const order = REGION_NAMES.indexOf(patch.name)
  const later = regionHeadings(doc).find((heading) => {
    const rank = REGION_NAMES.indexOf(heading.name as (typeof REGION_NAMES)[number])
    return rank > order
  })
  if (later) {
    s.appendLeft(later.start, `${text}${eol}`)
    return { start: later.start, end: later.start + text.length + eol.length }
  }
  let from = source.length
  while (from > 0 && /\s/.test(source[from - 1]!)) from--
  const insertion = `${eol}${eol}${text}`
  s.overwrite(from, source.length, insertion)
  return { start: from, end: from + insertion.length }
}

/** Rewrites the prose between the frontmatter and the visual contract. */
export function writeIntent(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'intent' }>,
  eol: '\r\n' | '\n',
): Range {
  const { start, end } = doc.intent.loc
  const text = patch.text.replace(/\r?\n/g, eol).trim()
  const lead = start === 0 ? '' : `${eol}${eol}`
  const replacement = text ? `${lead}${text}${eol}${eol}` : lead || ''
  if (start === end) s.appendLeft(start, replacement)
  else s.overwrite(start, end, replacement)
  return { start, end: start + replacement.length }
}

/** The contract's single elements: each written once, self-closing, attributes only. */
export type ContractElement = 'Accessibility' | 'Form' | 'Composes'
const ELEMENT_ORDER: readonly ContractElement[] = ['Form', 'Accessibility', 'Composes']

function printElement(element: ContractElement, attrs: Record<string, JsonValue>): string {
  const parts = Object.entries(attrs).flatMap(([key, value]) => {
    if (value === undefined || value === null || value === false) return []
    // `participates` is a flag: present or absent.
    if (value === true && element === 'Form') return [key]
    return [`${key}=${serializeValue(value)}`]
  })
  return `<${element}${parts.length ? ` ${parts.join(' ')}` : ''} />`
}

/**
 * Writes, replaces or removes `<Accessibility>`, `<Form>` or `<Composes>` in
 * `## Contract` (ADR 0013), creating the region when the file has none.
 */
export function writeContractElement(
  doc: UidxDocument,
  s: MagicString,
  patch: Extract<UidxPatch, { op: 'contract-element' }>,
  eol: '\r\n' | '\n',
): Range {
  const source = doc.source
  const span = spanOf(doc, 'Contract')
  const pattern = new RegExp(`<${patch.element}\\b[^>]*?/>`, 'g')
  pattern.lastIndex = span?.body ?? 0
  const found = span ? pattern.exec(source) : null
  const existing = found && found.index < span!.end ? found : null
  if (!patch.attrs) {
    if (!existing) throw new PatchError(`there is no <${patch.element}> in ## Contract to remove`)
    let from = existing.index
    while (from > 0 && /[ \t]/.test(source[from - 1]!)) from--
    if (from > 0 && source[from - 1] === '\n') from--
    if (from > 0 && source[from - 1] === '\r') from--
    s.remove(from, existing.index + existing[0].length)
    return { start: from, end: from }
  }
  const text = printElement(patch.element, patch.attrs)
  if (existing) {
    s.overwrite(existing.index, existing.index + existing[0].length, text)
    return { start: existing.index, end: existing.index + text.length }
  }
  if (span) {
    // In ADR 0013's order — Form, Accessibility, Composes — before the first
    // of them that follows this one, or at the end of the region.
    const later = ELEMENT_ORDER.slice(ELEMENT_ORDER.indexOf(patch.element) + 1)
      .map((element) => {
        const match = new RegExp(`<${element}\\b[^>]*?/>`, 'g')
        match.lastIndex = span.body
        const hit = match.exec(source)
        return hit && hit.index < span.end ? hit.index : -1
      })
      .filter((index) => index !== -1)
    if (later.length) {
      const at = Math.min(...later)
      s.appendLeft(at, `${text}${eol}`)
      return { start: at, end: at + text.length + eol.length }
    }
    let at = span.end
    while (at > span.body && /\s/.test(source[at - 1]!)) at--
    const insertion = `${eol}${text}`
    s.appendRight(at, insertion)
    return { start: at, end: at + insertion.length }
  }
  // No contract yet: the region goes before every other region.
  const first = regionHeadings(doc)[0]
  const block = `## Contract${eol}${eol}${text}${eol}`
  if (first) {
    s.appendLeft(first.start, `${block}${eol}`)
    return { start: first.start, end: first.start + block.length + eol.length }
  }
  let from = source.length
  while (from > 0 && /\s/.test(source[from - 1]!)) from--
  const insertion = `${eol}${eol}${block}`
  s.overwrite(from, source.length, insertion)
  return { start: from, end: from + insertion.length }
}

/** The element's attributes as written, for the inverse; undefined when it is absent. */
export function contractElementAttrs(
  doc: UidxDocument,
  element: ContractElement,
): Record<string, JsonValue> | undefined {
  const contract = doc.spec?.contract
  if (!contract) return undefined
  if (element === 'Accessibility') return contract.accessibility
  if (element === 'Form')
    return contract.form
      ? {
          participates: contract.form.participates,
          ...(contract.form.submits ? { submits: contract.form.submits } : {}),
        }
      : undefined
  return contract.composes.length ? { with: contract.composes.join(', ') } : undefined
}
