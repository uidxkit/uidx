import type { Architecture, PlannedComponent } from './architecture.js'

/**
 * A component's design.md, as a `## Design` section of its page's intent.
 *
 * The convention is Google Labs' DESIGN.md — a persistent, structured
 * description of a visual identity that agents read before they build
 * (github.com/google-labs-code/design.md) — folded into where uidx already
 * keeps prose: the Markdown intent above the Visual Contract. The format's
 * one-contract law stays untouched; the spec's *visual* representation is the
 * anatomy board drawn inside that one contract, and these words are the part
 * that survives every context window.
 *
 * Every line of content is model-authored — appearance distilled from
 * reference images, constraints extracted from research, the token plan by
 * tier — and only *assembled* here. The harness formats; it never invents a
 * pixel. Written after the component builds, read by any later task that
 * touches the component, which is what turns one page's research into a
 * design system's memory.
 *
 * Tokens documents and, later, design patterns carry the same section: the
 * structure is the convention, not the component.
 */
export function renderDesignSection(
  architecture: Architecture,
  component?: PlannedComponent,
): string {
  const lines: string[] = ['## Design', '']
  lines.push(
    `${architecture.summary} Distilled from research and reference images — read this before touching the component.`,
    '',
  )

  if (component) {
    lines.push('### Axes and props', '')
    for (const axis of component.axes) {
      lines.push(`- ${axis.name}: ${axis.values.join(' | ')}`)
    }
    for (const prop of component.props) lines.push(`- ${prop.name} (${prop.type}) — prop`)
    lines.push('')
  }

  if (architecture.appearance.length > 0) {
    lines.push('### Appearance', '')
    for (const line of architecture.appearance) lines.push(`- ${line}`)
    lines.push('')
  }

  if (architecture.constraints.length > 0) {
    lines.push('### Constraints', '')
    for (const constraint of architecture.constraints) lines.push(`- ${constraint}`)
    lines.push('')
  }

  if (architecture.tokens.length > 0) {
    lines.push('### Tokens', '')
    for (const binding of architecture.tokens) {
      const tier = binding.tier ? ` (${binding.tier})` : ''
      const status = binding.status === 'declare' ? ' — declared by this page' : ''
      lines.push(`- ${binding.collection}${tier} — ${binding.usedFor}${status}`)
    }
    lines.push('')
  }

  return lines.join('\n').trimEnd()
}

/**
 * Puts a `## Design` section into a page's source: replaces the existing one,
 * or inserts ahead of the Visual Contract when there is none.
 *
 * Splices text rather than parsing and re-emitting, the same way `setIntent`
 * does — the rest of the file, contract included, must come through
 * byte-for-byte.
 */
export function spliceDesignSection(source: string, section: string): string {
  const existing = /^## Design\s*$/m.exec(source)
  if (existing) {
    // Ends at the next same-level heading (any `## …`), or at end of file.
    const rest = source.slice(existing.index + existing[0].length)
    const next = /^## /m.exec(rest)
    const end = existing.index + existing[0].length + (next ? next.index : rest.length)
    return `${source.slice(0, existing.index)}${section}\n\n${source.slice(end)}`
  }
  const contract = /^## Visual Contract\s*$/m.exec(source)
  if (contract) {
    return `${source.slice(0, contract.index)}${section}\n\n${source.slice(contract.index)}`
  }
  // No contract to anchor on — append, which keeps the write total rather
  // than silently dropping the section.
  return `${source.trimEnd()}\n\n${section}\n`
}
