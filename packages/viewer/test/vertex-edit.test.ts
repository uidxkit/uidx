import { describe, expect, it } from 'vitest'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'
import { vectorNetworkToSVGPaths } from '@open-pencil/core'
import {
  flatIndexOf,
  handleNear,
  handleVisibility,
  hasHandle,
  moveHandle,
  moveVertex,
  networkOf,
  overlay,
  removeVertex,
  subpathsOf,
  vertexNear,
  type Subpath,
} from '../src/vertex-edit'

/**
 * The SDK is used here rather than faked, deliberately: D12's whole claim is
 * that the chains this module reads out of a network spell the same path the
 * file already held, and a hand-written fixture would only prove that the
 * fixture matches the code. `parseSVGPath` is the same function `toScene` runs.
 */
const chainsOf = (d: string): Subpath[] => subpathsOf(parseSVGPath(d, 'NONZERO'))
const respell = (subpaths: readonly Subpath[], windingRule = 'NONZERO'): string =>
  vectorNetworkToSVGPaths(networkOf(subpaths, windingRule) as never)[0] ?? ''

describe('reading a path apart', () => {
  it('reads an open chain, with a tangent on each side of the joins', () => {
    const [chain, ...rest] = chainsOf('M0 0C5 0 10 5 10 10')
    expect(rest).toHaveLength(0)
    expect(chain!.closed).toBe(false)
    expect(chain!.vertices).toEqual([
      { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 5, y: 0 } },
      { x: 10, y: 10, in: { x: 0, y: -5 }, out: { x: 0, y: 0 } },
    ])
  })

  it('reads a closed chain as its points, not its closing segment', () => {
    const [chain] = chainsOf('M0 0L10 0L10 10Z')
    // Three points, not four: the `Z` is a segment in the network and a
    // property of the chain here.
    expect(chain!.closed).toBe(true)
    expect(chain!.vertices.map((v) => [v.x, v.y])).toEqual([
      [0, 0],
      [10, 0],
      [10, 10],
    ])
  })

  it('reads an icon with a counter as two chains', () => {
    const chains = chainsOf('M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30L20 20Z')
    expect(chains).toHaveLength(2)
    expect(chains.every((c) => c.closed)).toBe(true)
    expect(chains[1]!.vertices[0]).toMatchObject({ x: 20, y: 20 })
  })

  it('round-trips a path back to the text the file already held', () => {
    for (const d of [
      'M0 0L10 0L10 10L0 0Z',
      'M0 0C5 0 10 5 10 10',
      'M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30L20 20Z',
      'M0 0C5 0 10 5 10 10C10 15 5 20 0 20L0 0Z',
    ]) {
      expect(respell(chainsOf(d))).toBe(d)
    }
  })

  it("makes a curve's closing line explicit, which is the one re-spelling", () => {
    // ADR 0006 §8's table: `Z` after a curve implies a straight run home, and
    // the network has to hold it as a segment. Canonical after one pass, so
    // this is the whole of what an author is warned about below.
    expect(respell(chainsOf('M0 0C5 0 10 5 10 10Z'))).toBe('M0 0C5 0 10 5 10 10L0 0Z')
  })

  it('keeps EVENODD, which only the region carries', () => {
    const network = networkOf(chainsOf('M0 0L10 0L10 10L0 0Z'), 'EVENODD')
    expect(network.regions).toEqual([{ windingRule: 'EVENODD', loops: [[0, 1, 2]] }])
  })

  it('gives an open chain no region, because it encloses nothing', () => {
    expect(networkOf(chainsOf('M0 0C5 0 10 5 10 10')).regions).toEqual([])
  })
})

describe('handles', () => {
  const open = chainsOf('M0 0C5 0 10 5 10 10')
  const closed = chainsOf('M0 0L10 0L10 10Z')

  it('offers no handle where an open chain has no segment', () => {
    expect(hasHandle(open[0]!, 0, 'in')).toBe(false)
    expect(hasHandle(open[0]!, 0, 'out')).toBe(true)
    expect(hasHandle(open[0]!, 1, 'in')).toBe(true)
    expect(hasHandle(open[0]!, 1, 'out')).toBe(false)
  })

  it('offers both on every point of a closed chain', () => {
    for (let i = 0; i < 3; i++) {
      expect(hasHandle(closed[0]!, i, 'in')).toBe(true)
      expect(hasHandle(closed[0]!, i, 'out')).toBe(true)
    }
  })

  it('draws handles for the selected point and its neighbours', () => {
    expect(handleVisibility(open, { subpath: 0, index: 0 })).toEqual(new Set(['0:0', '0:1']))
    expect(handleVisibility(open, null)).toEqual(new Set())
  })

  it('wraps the neighbours of a closed chain round its ends', () => {
    expect(handleVisibility(closed, { subpath: 0, index: 0 })).toEqual(
      new Set(['0:0', '0:1', '0:2']),
    )
  })
})

describe('hit-testing', () => {
  const chains = chainsOf('M0 0C5 0 10 5 10 10')
  const everything = new Set(['0:0', '0:1'])

  it('finds a vertex within the grab radius and nothing beyond it', () => {
    expect(vertexNear(chains, { x: 2, y: 2 }, 1)).toEqual({ subpath: 0, index: 0 })
    expect(vertexNear(chains, { x: 100, y: 100 }, 1)).toBeNull()
  })

  it('shrinks the grab radius as the canvas zooms in', () => {
    expect(vertexNear(chains, { x: 5, y: 0 }, 1)).toEqual({ subpath: 0, index: 0 })
    expect(vertexNear(chains, { x: 5, y: 0 }, 8)).toBeNull()
  })

  it('takes the nearer of two vertices', () => {
    const two = chainsOf('M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30L20 20Z')
    expect(vertexNear(two, { x: 19, y: 21 }, 1)).toEqual({ subpath: 1, index: 0 })
  })

  it('finds a handle where its grip is drawn — at the vertex plus its tangent', () => {
    expect(handleNear(chains, { x: 5, y: 0 }, 1, everything)).toEqual({
      subpath: 0,
      index: 0,
      side: 'out',
    })
  })

  it('ignores a handle the overlay is not drawing', () => {
    expect(handleNear(chains, { x: 5, y: 0 }, 1, new Set())).toBeNull()
  })

  it('ignores a zero-length handle, which sits on its own vertex', () => {
    // `M0 0L10 0` is two corners: every tangent is zero, so a press on either
    // point must find the point and never a handle standing on top of it.
    const corners = chainsOf('M0 0L10 0')
    expect(handleNear(corners, { x: 0, y: 0 }, 1, new Set(['0:0', '0:1']))).toBeNull()
  })
})

describe('moving a point', () => {
  it('carries the tangents with it, because they are offsets', () => {
    const moved = moveVertex(
      chainsOf('M0 0C5 0 10 5 10 10'),
      { subpath: 0, index: 0 },
      {
        x: 0,
        y: 20,
      },
    )
    expect(moved[0]!.vertices[0]).toEqual({ x: 0, y: 20, in: { x: 0, y: 0 }, out: { x: 5, y: 0 } })
    expect(respell(moved)).toBe('M0 20C5 20 10 5 10 10')
  })

  it('leaves the model it was given alone', () => {
    const before = chainsOf('M0 0L10 0')
    moveVertex(before, { subpath: 0, index: 0 }, { x: 50, y: 50 })
    expect(before[0]!.vertices[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('does nothing for a point that is not there', () => {
    const before = chainsOf('M0 0L10 0')
    expect(moveVertex(before, { subpath: 3, index: 0 }, { x: 1, y: 1 })).toEqual(before)
  })
})

describe('moving a handle', () => {
  /** A smooth point: `in` and `out` are exact opposites either side of (10,0). */
  const smooth = chainsOf('M0 0C4 0 6 0 10 0C14 0 16 0 20 0')

  it('takes the grip to the pointer', () => {
    const next = moveHandle(smooth, { subpath: 0, index: 1, side: 'out' }, { x: 14, y: 5 })
    expect(next[0]!.vertices[1]!.out).toEqual({ x: 4, y: 5 })
  })

  it('keeps a smooth point smooth: the far handle mirrors', () => {
    const next = moveHandle(smooth, { subpath: 0, index: 1, side: 'out' }, { x: 14, y: 5 })
    expect(next[0]!.vertices[1]!.in).toEqual({ x: -4, y: -5 })
  })

  it('leaves a corner a corner: the far handle stays put', () => {
    // `in` points up and `out` points right — not opposite, so not smooth.
    const corner: Subpath[] = [
      {
        closed: false,
        vertices: [
          { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
          { x: 10, y: 0, in: { x: 0, y: -4 }, out: { x: 4, y: 0 } },
          { x: 20, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
        ],
      },
    ]
    const next = moveHandle(corner, { subpath: 0, index: 1, side: 'out' }, { x: 14, y: 5 })
    expect(next[0]!.vertices[1]!.in).toEqual({ x: 0, y: -4 })
  })

  it('turns a differently-sized far handle without resizing it', () => {
    // Opposite directions, different lengths: Figma's ANGLE mirroring.
    const angle: Subpath[] = [
      {
        closed: false,
        vertices: [
          { x: 0, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
          { x: 10, y: 0, in: { x: -2, y: 0 }, out: { x: 6, y: 0 } },
          { x: 20, y: 0, in: { x: 0, y: 0 }, out: { x: 0, y: 0 } },
        ],
      },
    ]
    const next = moveHandle(angle, { subpath: 0, index: 1, side: 'out' }, { x: 10, y: 6 })
    expect(next[0]!.vertices[1]!.out).toEqual({ x: 0, y: 6 })
    // Turned to the opposite direction, still two units long.
    expect(next[0]!.vertices[1]!.in.x).toBe(0)
    expect(next[0]!.vertices[1]!.in.y).toBeCloseTo(-2, 10)
  })

  it('breaks the mirror when the drag says to', () => {
    const next = moveHandle(
      smooth,
      { subpath: 0, index: 1, side: 'out' },
      { x: 14, y: 5 },
      {
        independent: true,
      },
    )
    expect(next[0]!.vertices[1]!.in).toEqual({ x: -4, y: 0 })
  })

  it('reaches the file: a dragged handle changes the `d`', () => {
    const next = moveHandle(smooth, { subpath: 0, index: 1, side: 'out' }, { x: 14, y: 5 })
    // The first segment ends at this vertex, so it is `in` — now mirrored to
    // (-4,-5) — that moves its second control point to (6,-5).
    expect(respell(next)).toBe('M0 0C4 0 6 -5 10 0C14 5 16 0 20 0')
  })
})

describe('removing a point', () => {
  it('takes it out and leaves the rest joined up', () => {
    const next = removeVertex(chainsOf('M0 0L10 0L20 0'), { subpath: 0, index: 1 })!
    expect(respell(next)).toBe('M0 0L20 0')
  })

  it('takes the whole chain when two points would be left with one', () => {
    const next = removeVertex(chainsOf('M0 0L10 0L10 10L0 0ZM20 20L30 20'), {
      subpath: 1,
      index: 0,
    })!
    expect(next).toHaveLength(1)
    expect(respell(next)).toBe('M0 0L10 0L10 10L0 0Z')
  })

  it('refuses to empty the path, because that is deleting the shape', () => {
    expect(removeVertex(chainsOf('M0 0L10 0'), { subpath: 0, index: 0 })).toBeNull()
  })

  it('does nothing for a point that is not there', () => {
    expect(removeVertex(chainsOf('M0 0L10 0L20 0'), { subpath: 0, index: 9 })).toBeNull()
  })
})

describe('the overlay', () => {
  it('numbers a selected point as the flat network does', () => {
    const two = chainsOf('M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30L20 20Z')
    expect(flatIndexOf(two, { subpath: 1, index: 1 })).toBe(4)
    expect(overlay('v', two, { subpath: 1, index: 1 }).selectedVertexIndices).toEqual(new Set([4]))
  })

  it('hands the renderer the whole path, not only the selected chain', () => {
    const two = chainsOf('M0 0L10 0L10 10L0 0ZM20 20L30 20L30 30L20 20Z')
    const drawn = overlay('v', two, { subpath: 0, index: 0 })
    expect(drawn.vertices).toHaveLength(6)
    expect(drawn.segments).toHaveLength(6)
    expect(drawn.nodeId).toBe('v')
  })
})
