import { describe, expect, it } from 'vitest'
import { applyPatch, parseOrThrow, PatchError, resolve } from '../src/index.js'

/**
 * Cases that a real file will hit and the happy-path tests do not: foreign line
 * endings, astral-plane characters, and patches whose *result* is invalid.
 *
 * Every test here was written after finding a live bug. They are regression
 * tests, not speculation.
 */

const doc = (body: string, eol = '\n') =>
  ['---', 'id: probe', '', '---', '', '## Visual Contract', '', body, ''].join(eol)

const TREE = `<Component name="probe" status="draft">
  <Frame name="root">
    <Text name="a" characters="A" />
    <Text name="b" characters="B" />
  </Frame>
</Component>`

const crlf = () => doc(TREE.replace(/\n/g, '\r\n'), '\r\n')
/** A carriage return not followed by a newline — corrupted line endings. */
const hasLoneCr = (s: string) => /\r(?!\n)/.test(s)
/** A newline not preceded by a carriage return — mixed line endings in a CRLF file. */
const hasBareLf = (s: string) => /(?<!\r)\n/.test(s)

describe('CRLF documents', () => {
  it('parses and keeps the offset invariant', () => {
    const parsed = parseOrThrow(crlf())
    const attr = resolve(parsed.tree, 'probe#root/a')!.attrs.characters!
    expect(parsed.source.slice(attr.valueLoc.start, attr.valueLoc.end)).toBe(attr.raw)
  })

  it('remove-node leaves no lone carriage return', () => {
    const { source } = applyPatch(crlf(), { op: 'remove-node', address: 'probe#root/a' })
    expect(hasLoneCr(source)).toBe(false)
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.children.map((c) => c.name)).toEqual([
      'b',
    ])
  })

  it('move-node does not introduce mixed line endings', () => {
    const { source } = applyPatch(crlf(), {
      op: 'move-node',
      address: 'probe#root/b',
      newParent: 'probe#root',
      index: 0,
    })
    expect(hasLoneCr(source)).toBe(false)
    expect(hasBareLf(source)).toBe(false)
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.children.map((c) => c.name)).toEqual([
      'b',
      'a',
    ])
  })

  it('insert-node emits CRLF for the block it generates', () => {
    const { source } = applyPatch(crlf(), {
      op: 'insert-node',
      parent: 'probe#root',
      index: 1,
      node: { element: 'Rectangle', attrs: { name: 'sep', width: 1 } },
    })
    expect(hasBareLf(source)).toBe(false)
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.children.map((c) => c.name)).toEqual([
      'a',
      'sep',
      'b',
    ])
  })

  it('add on a multi-line tag uses CRLF', () => {
    const multi = doc(
      `<Component name="probe" status="draft">\r\n  <Frame\r\n    name="root"\r\n    cornerRadius={4}\r\n  />\r\n</Component>`,
      '\r\n',
    )
    const { source } = applyPatch(multi, {
      op: 'add',
      address: 'probe#root',
      prop: 'opacity',
      value: 0.5,
    })
    expect(hasBareLf(source)).toBe(false)
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.attrs.opacity!.value).toBe(0.5)
  })
})

describe('astral-plane characters', () => {
  const emoji = doc(`<Component name="probe" status="draft">
  <Frame name="root">
    <Text name="a" characters="🎉 party 🎉" />
    <Text name="b" characters="after" />
  </Frame>
</Component>`)

  it('keeps offsets correct for content after an emoji', () => {
    const parsed = parseOrThrow(emoji)
    const attr = resolve(parsed.tree, 'probe#root/b')!.attrs.characters!
    expect(parsed.source.slice(attr.valueLoc.start, attr.valueLoc.end)).toBe('"after"')
  })

  it('patches around emoji without corrupting them', () => {
    const { source } = applyPatch(emoji, {
      op: 'set',
      address: 'probe#root/b',
      prop: 'characters',
      value: 'patched',
    })
    expect(source).toContain('characters="🎉 party 🎉"')
    expect(source).toContain('characters="patched"')
  })

  it('round-trips an emoji through a set', () => {
    const { source } = applyPatch(emoji, {
      op: 'set',
      address: 'probe#root/b',
      prop: 'characters',
      value: '✅ done',
    })
    expect(resolve(parseOrThrow(source).tree, 'probe#root/b')!.attrs.characters!.value).toBe(
      '✅ done',
    )
  })
})

describe('a patch may never produce an unreadable file (spec §9.5)', () => {
  it('rejects a rename that collides with a sibling', () => {
    expect(() =>
      applyPatch(doc(TREE), { op: 'set', address: 'probe#root/a', prop: 'name', value: 'b' }),
    ).toThrow(PatchError)
  })

  it('names the offending diagnostic in the rejection', () => {
    try {
      applyPatch(doc(TREE), { op: 'set', address: 'probe#root/a', prop: 'name', value: 'b' })
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).message).toMatch(/UIDX102: duplicate sibling name "b"/)
    }
  })

  it('leaves the original source untouched when it rejects', () => {
    const source = doc(TREE)
    try {
      applyPatch(source, { op: 'set', address: 'probe#root/a', prop: 'name', value: 'b' })
    } catch {
      /* expected */
    }
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.children.map((c) => c.name)).toEqual([
      'a',
      'b',
    ])
  })

  it('can be opted out of for callers that will validate themselves', () => {
    const { source } = applyPatch(
      doc(TREE),
      { op: 'set', address: 'probe#root/a', prop: 'name', value: 'b' },
      { validate: false },
    )
    expect(source).toContain('name="b"')
  })

  it('still allows a rename that does not collide', () => {
    const { source } = applyPatch(doc(TREE), {
      op: 'set',
      address: 'probe#root/a',
      prop: 'name',
      value: 'renamed',
    })
    expect(resolve(parseOrThrow(source).tree, 'probe#root')!.children.map((c) => c.name)).toEqual([
      'renamed',
      'b',
    ])
  })
})
