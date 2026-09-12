import type { DocumentIndex } from './types.js'

export interface DocMapOptions {
  /**
   * Soft ceiling. Sections are dropped from the end, never truncated mid-line,
   * so the result is bounded by whole sections rather than by this number: the
   * accounting counts one separator per section while the join writes two, and
   * the "omitted" note is appended after the last check. Left as-is on purpose
   * — the caller slices the whole pack to its own budget anyway, and a map that
   * breaks mid-line to hit an exact figure is worth less than one that does not.
   */
  maxChars?: number
  /**
   * The page the designer is looking at, marked in place rather than left to
   * look like every other row. The same file appears above this map as its own
   * `CURRENT PAGE` block, and an unmarked duplicate down here is an invitation
   * to read the thinner of the two — which is exactly how a model came to
   * answer about `card.uidx` when the designer was on `bound-card.uidx`.
   */
  currentFile?: string | null
}

const DEFAULT_MAX_CHARS = 6000

/**
 * How many files a relation names before it starts counting. A component used
 * on forty pages must not spend forty lines of a budget the whole map shares.
 */
const MAX_NAMED_FILES = 4

/** `home.uidx, about.uidx, (+7 more)` — the shape every relation here uses. */
function namedFiles(files: readonly string[]): string {
  const unique = [...new Set(files)].sort()
  const named = unique.slice(0, MAX_NAMED_FILES)
  const rest = unique.length - named.length
  return `${named.join(', ')}${rest > 0 ? `, (+${rest} more)` : ''}`
}

function componentLine(index: DocumentIndex, name: string): string {
  const entry = index.components.get(name)!
  const props = entry.props.map((p) => `${p.name}: ${p.type}`).join(', ')
  const slots = entry.slots.length ? ` slots: ${entry.slots.join(', ')}` : ''
  const variants = entry.variants.length ? ` variants: ${entry.variants.length}` : ''
  const status = entry.status ? ` [${entry.status}]` : ''
  // "used 3×" answered how many and never which, and which is the question
  // asked before changing a component: the count cannot tell a designer what
  // their edit is about to move.
  const uses = index.usesOfComponent(name)
  const where =
    uses.length > 0 ? ` — used by ${namedFiles(uses.map((use) => use.file))}` : ' — unused'
  return `  ${name}(${props})${slots}${variants}${status}${where}, in ${entry.file}`
}

/**
 * The orientation a small model needs and cannot reliably search for: what
 * exists, what it is called, and what is already reused. Bodies stay on disk.
 */
export function renderDocMap(index: DocumentIndex, options: DocMapOptions = {}): string {
  const max = options.maxChars ?? DEFAULT_MAX_CHARS
  const sections: string[] = []

  if (index.components.size > 0) {
    const names = [...index.components.keys()].sort()
    sections.push(['COMPONENTS', ...names.map((name) => componentLine(index, name))].join('\n'))
  }

  const pages = [...index.pages.values()].filter((p) => p.kind === 'page')
  if (pages.length > 0) {
    sections.push(
      [
        'PAGES',
        ...pages.map((page) => {
          const nodes = page.topLevel.map((n) => `${n.name}<${n.element}>`).join(', ')
          const here = page.file === options.currentFile ? '  ← the page you are on' : ''
          // `headings` has been computed on every index build since Phase 1 and
          // shown to nobody. A page's own sections are how a mission like "fix
          // the contrast note" reaches `doc#accessibility` without reading its
          // way there.
          const sections =
            page.headings.length > 0 ? `\n    sections: ${page.headings.join(', ')}` : ''
          return `  ${page.file} (${page.nodeCount} nodes): ${nodes || '(empty)'}${here}${sections}`
        }),
      ].join('\n'),
    )
  }

  if (index.variables.size > 0) {
    const lines = [...index.variables.values()]
      .sort((a, b) => a.address.localeCompare(b.address))
      .map((v) => {
        // The one question a token scale exists to make answerable, and the
        // index has always been able to answer it.
        const uses = index.usesOfVariable(v.address)
        const bound = uses.length > 0 ? ` — bound by ${namedFiles(uses.map((u) => u.file))}` : ''
        return `  ${v.address}: ${v.type}${bound}`
      })
    sections.push(['TOKENS', ...lines].join('\n'))
  }

  // Every section keeps its heading and as many of its own lines as an equal
  // share affords, rather than the sections at the end being dropped whole. A
  // document large enough to exceed the budget used to lose all of TOKENS
  // while COMPONENTS printed in full — leaving a precise view of one third of
  // the document and no sign the rest existed. A section that says "12 more,
  // not shown" is a section the model knows to ask about.
  const share = Math.floor(max / Math.max(1, sections.length))
  const kept = sections.map((section) => {
    if (section.length <= share) return section
    const lines = section.split('\n')
    const head = [lines[0]!]
    let used = head[0]!.length
    for (const line of lines.slice(1)) {
      if (used + line.length + 1 > share) break
      head.push(line)
      used += line.length + 1
    }
    const hidden = lines.length - head.length
    return `${head.join('\n')}\n  (${hidden} more, not shown)`
  })

  return kept.join('\n\n')
}
