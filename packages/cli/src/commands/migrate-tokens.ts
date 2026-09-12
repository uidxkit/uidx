import { readFile, writeFile } from 'node:fs/promises'
import type { Io } from '../cli.js'

/**
 * Writes the `type` every `<Variable>` declares since G8.
 *
 * A **textual** transform rather than a parse-and-print one, and it has to be:
 * a file missing `type` no longer parses — `UIDX122` is an error, so `parse`
 * returns no document — and a codemod that can only read files that are already
 * correct is no use to anyone.
 *
 * The type is derived the way `variableTypeOf` derives it, from the shape of
 * the authored value. An alias is the one case that cannot be automated: it has
 * no type of its own, it takes its target's, and the target may live in another
 * document while this sees one file at a time. Those are reported by name so
 * the author can type them by hand — `uidx check` will keep failing until they
 * do, which is the right kind of unfinished.
 */
export interface MigrationResult {
  source: string
  changed: number
  /** Variables whose value is an alias, left for the author to type. */
  aliases: string[]
}

/** `<Variable ... >` or `<Variable ... />`, across lines. */
const VARIABLE_TAG = /<Variable\b[^>]*?\/?>/g
const NAME_ATTR = /\bname\s*=\s*"([^"]*)"/
const TYPE_ATTR = /\btype\s*=\s*"/
/** `value={...}` with one level of nesting, or `value="..."`. */
const VALUE_EXPR = /\bvalue\s*=\s*\{((?:[^{}]|\{[^{}]*\})*)\}/
const VALUE_STRING = /\bvalue\s*=\s*"([^"]*)"/

/** The Figma variable type an authored value implies, or null when it is an alias. */
function typeOfSource(tag: string): 'FLOAT' | 'BOOLEAN' | 'COLOR' | 'STRING' | null {
  const expr = VALUE_EXPR.exec(tag)
  if (expr) {
    const body = expr[1]!.trim()
    if (body === 'true' || body === 'false') return 'BOOLEAN'
    if (body.startsWith('{')) return /\br\s*:/.test(body) ? 'COLOR' : null
    return Number.isFinite(Number(body)) ? 'FLOAT' : null
  }
  const str = VALUE_STRING.exec(tag)
  if (!str) return null
  // A braced string is an alias, whose type is its target's — not ours to say.
  return /^\{[^{}]+\}$/.test(str[1]!.trim()) ? null : 'STRING'
}

export function migrateTokens(source: string): MigrationResult {
  const aliases: string[] = []
  let changed = 0

  const out = source.replace(VARIABLE_TAG, (tag) => {
    if (TYPE_ATTR.test(tag)) return tag
    const name = NAME_ATTR.exec(tag)
    if (!name) return tag

    const type = typeOfSource(tag)
    if (type === null) {
      aliases.push(name[1]!)
      return tag
    }

    changed++
    // Inserted straight after `name`, so a migrated file reads in the order the
    // examples use rather than with the type trailing its value.
    return tag.replace(name[0], `${name[0]} type="${type}"`)
  })

  return { source: out, changed, aliases }
}

/** `uidx migrate tokens <files...>` */
export async function runMigrateTokens(files: readonly string[], io: Io): Promise<number> {
  if (files.length === 0) {
    io.err('usage: uidx migrate tokens <file...>\n')
    return 1
  }

  let total = 0
  const unresolved: string[] = []
  for (const file of files) {
    const before = await readFile(file, 'utf8')
    const { source, changed, aliases } = migrateTokens(before)
    if (changed > 0) await writeFile(file, source, 'utf8')
    total += changed
    for (const alias of aliases) unresolved.push(`${file}: ${alias}`)
  }

  io.out(`${total} variable(s) typed\n`)
  if (unresolved.length) {
    io.err(
      `\n${unresolved.length} alias(es) need a type by hand — an alias takes its ` +
        `target's type, which one file cannot see:\n` +
        unresolved.map((u) => `  ${u}`).join('\n') +
        '\n',
    )
  }
  return 0
}
