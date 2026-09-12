import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { buildTokenIndex, IMPLICIT_MODE } from '../src/token-index.js'

const doc = (body: string) => parseOrThrow(`---\nid: t\n---\n\n## Visual Contract\n\n${body}\n`)

const FLAT = doc(`<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} scopes={['CORNER_RADIUS']} description="Cards." />
  </Collection>
</Tokens>`)

const MODED = doc(`<Tokens>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="surface" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`)

describe('buildTokenIndex (G8)', () => {
  it('indexes a flat collection under an implicit mode', () => {
    const index = buildTokenIndex([FLAT])
    const entry = index.entries.get('radius#md')!
    expect(entry.type).toBe('FLOAT')
    expect(entry.scopes).toEqual(['CORNER_RADIUS'])
    expect(entry.description).toBe('Cards.')
    expect(entry.valuesByMode).toEqual({ [IMPLICIT_MODE]: 8 })
    expect(index.collections.get('radius')!.modes).toEqual([IMPLICIT_MODE])
  })

  it('carries deprecated when the variable declares it, false otherwise', () => {
    const marked = doc(`<Tokens>
  <Collection name="c">
    <Variable name="old" type="FLOAT" value={4} deprecated={true} />
    <Variable name="live" type="FLOAT" value={8} />
  </Collection>
</Tokens>`)
    const index = buildTokenIndex([marked])
    expect(index.entries.get('c#old')!.deprecated).toBe(true)
    expect(index.entries.get('c#live')!.deprecated).toBe(false)
  })

  it('defaults scopes to ALL_SCOPES and description to empty', () => {
    const bare = doc(`<Tokens>
  <Collection name="c"><Variable name="v" type="FLOAT" value={1} /></Collection>
</Tokens>`)
    const entry = buildTokenIndex([bare]).entries.get('c#v')!
    expect(entry.scopes).toEqual(['ALL_SCOPES'])
    expect(entry.description).toBe('')
  })

  it('indexes every mode of a moded collection, leftmost first', () => {
    const index = buildTokenIndex([MODED])
    expect(index.collections.get('semantic')!.modes).toEqual(['light', 'dark'])
    const entry = index.entries.get('semantic#surface')!
    expect(Object.keys(entry.valuesByMode)).toEqual(['light', 'dark'])
    expect(entry.valuesByMode.dark).toEqual({ r: 0, g: 0, b: 0, a: 1 })
  })

  it('spans documents, since names are global (ADR 0004 §2)', () => {
    const index = buildTokenIndex([FLAT, MODED])
    expect([...index.collections.keys()].sort()).toEqual(['radius', 'semantic'])
  })

  it('ignores documents that are not token files', () => {
    const page = doc(`<Page><Frame name="f" /></Page>`)
    expect(buildTokenIndex([page]).entries.size).toBe(0)
  })
})
