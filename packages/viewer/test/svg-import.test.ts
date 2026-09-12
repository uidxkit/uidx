import { describe, expect, it } from 'vitest'
import { emitTree, parseOrThrow } from '@uidx/format'

import { importSvg, type SvgImport } from '../src/svg-import'

const svg = (body: string, attrs = 'width="24" height="24" viewBox="0 0 24 24"') =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`

const vectors = (r: SvgImport) =>
  r.node?.element === 'Vector' ? [r.node] : (r.node?.children ?? [])
const dataOf = (r: SvgImport, i = 0) =>
  (vectors(r)[i]?.attrs.vectorPaths as { data: string }[])[0]!.data
const kinds = (r: SvgImport) => r.problems.map((p) => p.kind).sort()

describe('reading paths across', () => {
  it('takes the d string as written, rather than rebuilding it', () => {
    // The whole point: `vectorPaths` is a `d` string and so is the source, so
    // an arc stays an arc. Going through a VectorNetwork would not keep it.
    const d = 'M2 2 L10 2 A 4 4 0 0 1 10 10 Z'
    const out = importSvg(svg(`<path d="${d}" fill="#ff0000"/>`), 'icon')
    expect(dataOf(out)).toContain('A')
    expect(out.node?.element).toBe('Vector')
  })

  it('makes one Vector per path, in a frame, rather than one that forgot which was which', () => {
    const out = importSvg(
      svg('<path d="M0 0 L4 4"/><path d="M4 0 L0 4"/><path d="M0 2 L4 2"/>'),
      'icon',
    )
    expect(out.node?.element).toBe('Frame')
    expect(out.node?.children?.map((c) => c.element)).toEqual(['Vector', 'Vector', 'Vector'])
    expect(out.node?.children?.map((c) => c.attrs.name)).toEqual([
      'icon-path-1',
      'icon-path-2',
      'icon-path-3',
    ])
  })

  it('keeps a lone path as a Vector under the name it was given', () => {
    const out = importSvg(svg('<path d="M0 0 L4 4"/>'), 'tick')
    expect(out.node).toMatchObject({ element: 'Vector', attrs: { name: 'tick' } })
  })

  it('says nothing was drawable rather than making an empty node', () => {
    expect(importSvg(svg('<defs><path d="M0 0 L1 1"/></defs>'), 'x').node).toBeNull()
    expect(importSvg('not an svg at all', 'x').node).toBeNull()
  })
})

describe('geometry the format has to be told in path data', () => {
  it('converts the basic shapes exactly', () => {
    expect(dataOf(importSvg(svg('<rect x="1" y="2" width="8" height="4"/>'), 'r'))).toBe(
      'M1 2H9V6H1Z',
    )
    expect(dataOf(importSvg(svg('<line x1="0" y1="1" x2="2" y2="3"/>'), 'l'))).toBe('M0 1L2 3')
    expect(dataOf(importSvg(svg('<polygon points="0,0 4,0 4,4"/>'), 'p'))).toBe('M0 0L4 0L4 4Z')
    expect(dataOf(importSvg(svg('<polyline points="0,0 4,0"/>'), 'p'))).toBe('M0 0L4 0')
  })

  it('draws a circle as two half-arcs, since one full arc is degenerate', () => {
    const d = dataOf(importSvg(svg('<circle cx="5" cy="5" r="3"/>'), 'c'))
    expect(d.match(/A/g)).toHaveLength(2)
    expect(d.startsWith('M2 5')).toBe(true)
  })

  it('rounds a rect only when it was asked to, and mirrors a lone rx', () => {
    expect(dataOf(importSvg(svg('<rect width="8" height="8"/>'), 'r'))).not.toContain('A')
    expect(dataOf(importSvg(svg('<rect width="8" height="8" rx="2"/>'), 'r'))).toContain('A2 2')
  })
})

describe('transforms', () => {
  it('bakes an ancestor transform into the coordinates', () => {
    const out = importSvg(svg('<g transform="translate(10 5)"><path d="M0 0 L2 0"/></g>'), 'i')
    expect(dataOf(out)).toBe('M10 5L12 5')
  })

  it('composes transforms down the tree', () => {
    const out = importSvg(
      svg('<g transform="translate(10 0)"><g transform="scale(2)"><path d="M1 1 L2 1"/></g></g>'),
      'i',
    )
    expect(dataOf(out)).toBe('M12 2L14 2')
  })

  /**
   * The single most common way an SVG import looks wrong: an icon authored in a
   * 24-unit viewBox and placed at 96px arrives at a quarter of its size.
   */
  it('maps the viewBox onto the size the node will have', () => {
    const out = importSvg(
      svg('<path d="M0 0 L12 0"/>', 'width="96" height="96" viewBox="0 0 24 24"'),
      'i',
    )
    expect(out.size).toEqual({ width: 96, height: 96 })
    expect(dataOf(out)).toBe('M0 0L48 0')
  })

  it('honours a viewBox origin that is not zero', () => {
    const out = importSvg(
      svg('<path d="M10 10 L12 10"/>', 'width="4" height="4" viewBox="10 10 4 4"'),
      'i',
    )
    expect(dataOf(out)).toBe('M0 0L2 0')
  })

  it('falls back to the viewBox for a size, and to 100 for neither', () => {
    expect(importSvg(svg('<path d="M0 0 L1 1"/>', 'viewBox="0 0 32 16"'), 'i').size).toEqual({
      width: 32,
      height: 16,
    })
    expect(importSvg(svg('<path d="M0 0 L1 1"/>', ''), 'i').size).toEqual({
      width: 100,
      height: 100,
    })
  })
})

describe('paints', () => {
  it('lands fills and strokes on the paint stack C8 already ships', () => {
    const out = importSvg(
      svg('<path d="M0 0 L1 1" fill="#ff0000" stroke="rgb(0,0,255)" stroke-width="3"/>'),
      'i',
    )
    expect(vectors(out)[0]!.attrs.fills).toEqual([
      { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } },
    ])
    expect(vectors(out)[0]!.attrs.strokes).toEqual([
      { type: 'SOLID', color: { r: 0, g: 0, b: 1, a: 1 } },
    ])
    expect(vectors(out)[0]!.attrs.strokeWeight).toBe(3)
  })

  it('inherits fill down the tree, the way SVG does', () => {
    const out = importSvg(svg('<g fill="#00ff00"><path d="M0 0 L1 1"/></g>'), 'i')
    expect(vectors(out)[0]!.attrs.fills).toEqual([
      { type: 'SOLID', color: { r: 0, g: 1, b: 0, a: 1 } },
    ])
  })

  it('writes no paint at all for none, rather than a black one', () => {
    const out = importSvg(svg('<path d="M0 0 L1 1" fill="none" stroke="none"/>'), 'i')
    expect(vectors(out)[0]!.attrs.fills).toBeUndefined()
    expect(vectors(out)[0]!.attrs.strokes).toBeUndefined()
  })

  it('folds opacity down the tree into the paint', () => {
    const out = importSvg(svg('<g opacity="0.5"><path d="M0 0 L1 1" fill="#000"/></g>'), 'i')
    expect(vectors(out)[0]!.attrs.fills).toEqual([
      { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 0.5 },
    ])
  })

  it('carries fill-rule across as the winding rule', () => {
    const out = importSvg(svg('<path d="M0 0 L1 1" fill-rule="evenodd"/>'), 'i')
    // Spelled exactly as the source spelled it: nothing transformed this path,
    // so nothing re-serialised it either.
    expect(vectors(out)[0]!.attrs.vectorPaths).toEqual([
      { windingRule: 'EVENODD', data: 'M0 0 L1 1' },
    ])
  })

  it('leaves an untransformed path byte for byte as the author wrote it', () => {
    const d = 'M2.5 2 C 4 2, 6 4, 6 5.5 L 2.5 9 Z'
    const out = importSvg(svg(`<path d="${d}"/>`), 'i')
    expect(dataOf(out)).toBe(d)
  })
})

/**
 * D8's rule: what the importer cannot represent is reported, not dropped. A
 * silently simplified logo is worse than a refused one.
 */
describe('what it cannot represent, it says', () => {
  it('names text, rasters, uses and nested svgs, and imports the rest', () => {
    const out = importSvg(
      svg('<path d="M0 0 L1 1"/><text x="0" y="0">hi</text><image href="a.png"/><use href="#a"/>'),
      'i',
    )
    expect(kinds(out)).toEqual(['image', 'text', 'use'])
    expect(vectors(out)).toHaveLength(1)
  })

  it('names a filter, a clip path and a mask, and says the shape drew without them', () => {
    const out = importSvg(
      svg('<path d="M0 0 L1 1" filter="url(#f)" clip-path="url(#c)" mask="url(#m)"/>'),
      'i',
    )
    expect(kinds(out)).toEqual(['clip-path', 'filter', 'mask'])
    expect(out.problems.every((p) => p.detail.includes('drawn without it'))).toBe(true)
  })

  it('leaves a gradient reference unpainted rather than guessing a colour', () => {
    const out = importSvg(svg('<path d="M0 0 L1 1" fill="url(#grad)"/>'), 'i')
    expect(kinds(out)).toEqual(['paint-reference'])
    expect(vectors(out)[0]!.attrs.fills).toBeUndefined()
  })

  it('says a stylesheet was ignored, since class-based paints are not read', () => {
    const out = importSvg(svg('<style>.a{fill:red}</style><path class="a" d="M0 0 L1 1"/>'), 'i')
    expect(kinds(out)).toContain('stylesheet')
  })

  it('counts repeats rather than repeating itself', () => {
    const out = importSvg(svg('<text>a</text><text>b</text><text>c</text>'), 'i')
    expect(out.problems).toHaveLength(1)
    expect(out.problems[0]).toMatchObject({ kind: 'text', count: 3 })
  })
})

describe('what it produces is a document', () => {
  it('emits and parses back as the nodes it claimed to make', () => {
    const out = importSvg(
      svg('<rect width="8" height="8" fill="#123456"/><circle cx="4" cy="4" r="2"/>'),
      'logo',
    )
    const source = `---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${emitTree(out.node!, '  ')}\n</Page>\n`
    const page = parseOrThrow(source)
    const frame = page.tree.children[0]!
    expect(frame.element).toBe('Frame')
    expect(frame.children.map((c) => c.element)).toEqual(['Vector', 'Vector'])
    expect(frame.children[0]!.attrs.vectorPaths?.value).toEqual([
      { windingRule: 'NONZERO', data: 'M0 0H8V8H0Z' },
    ])
  })
})
