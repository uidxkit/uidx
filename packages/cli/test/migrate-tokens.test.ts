import { describe, expect, it } from 'vitest'
import { migrateTokens } from '../src/commands/migrate-tokens.js'

describe('uidx migrate tokens (G8)', () => {
  it('derives a type from the value', () => {
    const { source, changed } = migrateTokens(
      `<Variable name="md" value={8} />\n` +
        `<Variable name="w" value={{ r: 1, g: 1, b: 1, a: 1 }} />\n` +
        `<Variable name="f" value="Inter" />\n` +
        `<Variable name="b" value={true} />`,
    )
    expect(source).toContain('<Variable name="md" type="FLOAT" value={8} />')
    expect(source).toContain('<Variable name="w" type="COLOR" value=')
    expect(source).toContain('<Variable name="f" type="STRING" value="Inter" />')
    expect(source).toContain('<Variable name="b" type="BOOLEAN" value={true} />')
    expect(changed).toBe(4)
  })

  it('leaves a variable that already declares a type', () => {
    const src = `<Variable name="md" type="FLOAT" value={8} />`
    expect(migrateTokens(src)).toEqual({ source: src, changed: 0, aliases: [] })
  })

  // An alias has no type of its own, and the codemod sees one file at a time
  // while the target may live in another. Reported, not guessed.
  it('reports an alias rather than typing it', () => {
    const { source, changed, aliases } = migrateTokens(
      `<Variable name="brand" value="{palette#blue}" />`,
    )
    expect(changed).toBe(0)
    expect(source).not.toContain('type=')
    expect(aliases).toEqual(['brand'])
  })

  it('handles a multi-line tag', () => {
    const { source, changed } = migrateTokens(`<Variable\n  name="md"\n  value={8}\n/>`)
    expect(changed).toBe(1)
    expect(source).toContain('name="md" type="FLOAT"')
  })

  it('leaves everything that is not a <Variable> alone', () => {
    const src = `<Frame name="f" cornerRadius="{radius#md}" />`
    expect(migrateTokens(src)).toEqual({ source: src, changed: 0, aliases: [] })
  })
})
