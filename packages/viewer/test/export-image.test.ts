import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clampScale,
  downloadFile,
  fileNameFor,
  mimeTypeFor,
  pageIdFor,
  pixelSizeFor,
  rasterFormatFor,
} from '../src/export-image'

describe('the pixel size an export lands on', () => {
  it('rounds up, the way the renderer does', () => {
    // `renderNodesToImage` computes `Math.ceil(extent * scale)`. A readout that
    // rounded to nearest would promise 149 and deliver 150.
    expect(pixelSizeFor({ minX: 0, minY: 0, maxX: 99.4, maxY: 33.2 }, 1.5)).toEqual({
      width: 150,
      height: 50,
    })
  })

  it('measures the visual bounds, so a shadow is part of the picture', () => {
    // The bounds handed in are `computeContentBounds`', which already spread to
    // cover strokes and effects — the readout must not re-derive them from a
    // node's authored width.
    expect(pixelSizeFor({ minX: -12, minY: -12, maxX: 212, maxY: 112 }, 2)).toEqual({
      width: 448,
      height: 248,
    })
  })

  it('has no answer for bounds with no extent', () => {
    expect(pixelSizeFor({ minX: 4, minY: 4, maxX: 4, maxY: 9 }, 2)).toBeNull()
  })
})

describe('the name of the file an export writes', () => {
  it('is the layer and the format, at 1x', () => {
    expect(fileNameFor('container', 'PNG', 1)).toBe('container.png')
  })

  it('carries the multiplier once the export is not 1x', () => {
    expect(fileNameFor('container', 'PNG', 2)).toBe('container@2x.png')
  })

  it('spells a fractional multiplier as it was typed', () => {
    expect(fileNameFor('container', 'PNG', 1.5)).toBe('container@1.5x.png')
  })

  it('gives JPEG the extension the world writes it with', () => {
    expect(fileNameFor('container', 'JPEG', 1)).toBe('container.jpg')
  })

  it('never puts a multiplier on an SVG, which has no pixels to multiply', () => {
    expect(fileNameFor('container', 'SVG', 2)).toBe('container.svg')
  })

  it('flattens a component path, which is a name and not a directory', () => {
    expect(fileNameFor('Button/Primary', 'PNG', 1)).toBe('Button-Primary.png')
  })

  it('falls back to a word rather than writing a bare extension', () => {
    expect(fileNameFor('   ', 'PNG', 1)).toBe('layer.png')
  })
})

describe('the scale the panel will accept', () => {
  it('holds a typed-in absurdity to the panel ceiling', () => {
    // The scene graph's own `clampExportScale` stops at 1024, which is the file
    // format's limit and not a survivable canvas: a 400pt frame at 1024x is
    // 409,600px on a side. The panel's range is its own.
    expect(clampScale(1000)).toBe(4)
  })

  it('refuses a scale that would render nothing', () => {
    expect(clampScale(0)).toBe(0.01)
  })

  it('leaves an ordinary multiplier alone', () => {
    expect(clampScale(2)).toBe(2)
  })

  it('reads a non-number as 1x rather than as NaN pixels', () => {
    expect(clampScale(Number.NaN)).toBe(1)
  })
})

describe('what a format is called on the wire', () => {
  it('names each of the three', () => {
    expect(mimeTypeFor('PNG')).toBe('image/png')
    expect(mimeTypeFor('JPEG')).toBe('image/jpeg')
    expect(mimeTypeFor('SVG')).toBe('image/svg+xml')
  })
})

describe('the page an export renders on', () => {
  /**
   * `renderNodesToImage` throws if the nodes it is given do not all sit on the
   * page id it is handed, so this has to be the node's own page and not
   * whichever one is open.
   */
  const graph = {
    nodes: new Map(
      Object.entries({
        page: { id: 'page', type: 'CANVAS', parentId: 'doc' },
        card: { id: 'card', type: 'FRAME', parentId: 'page' },
        label: { id: 'label', type: 'TEXT', parentId: 'card' },
        orphan: { id: 'orphan', type: 'FRAME', parentId: 'gone' },
        loose: { id: 'loose', type: 'FRAME', parentId: null },
      }),
    ),
    getNode(id: string) {
      return this.nodes.get(id)
    },
  }

  it('climbs past every frame between the node and its page', () => {
    expect(pageIdFor(graph, 'label')).toBe('page')
  })

  it('answers with the page itself when the page is what was asked about', () => {
    expect(pageIdFor(graph, 'page')).toBe('page')
  })

  it('has no answer for a node whose parent is gone', () => {
    expect(pageIdFor(graph, 'orphan')).toBeNull()
  })

  it('has no answer for a node with nothing above it', () => {
    expect(pageIdFor(graph, 'loose')).toBeNull()
  })

  it('has no answer for a node that is not in the graph', () => {
    expect(pageIdFor(graph, 'never-existed')).toBeNull()
  })
})

describe('what the renderer is asked for', () => {
  /**
   * Skia spells it `JPG`, and its `ckImageFormat` falls through to PNG for
   * anything it does not recognise. Handing it the panel's word would write
   * PNG bytes into a file called `.jpg` — no error, no warning, a corrupt
   * asset that most viewers open anyway and some pipelines reject.
   */
  it("spells JPEG the way Skia does, so it isn't silently rendered as PNG", () => {
    expect(rasterFormatFor('JPEG')).toBe('JPG')
  })

  it('passes PNG through unchanged', () => {
    expect(rasterFormatFor('PNG')).toBe('PNG')
  })

  it('has no raster answer for SVG, which is not rendered at all', () => {
    expect(rasterFormatFor('SVG')).toBeNull()
  })
})

describe('handing the bytes to the browser', () => {
  const urls: string[] = []
  const revoked: string[] = []

  // jsdom implements neither half of the object-URL API, so the factory is
  // stubbed. What is under test is the element the function builds around it.
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:${urls.length}`
      urls.push(url)
      void blob
      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })

  afterEach(() => {
    urls.length = 0
    revoked.length = 0
  })

  it('clicks an anchor that carries the file name', () => {
    const clicked: HTMLAnchorElement[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })

    downloadFile(new Uint8Array([1, 2, 3]), 'container@2x.png', 'image/png')

    expect(clicked).toHaveLength(1)
    expect(clicked[0]!.download).toBe('container@2x.png')
    expect(clicked[0]!.href).toContain('blob:')
    click.mockRestore()
  })

  it('leaves no anchor behind in the document', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadFile('<svg/>', 'container.svg', 'image/svg+xml')

    expect(document.querySelectorAll('a')).toHaveLength(0)
    click.mockRestore()
  })

  it('releases the object URL it took', () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    downloadFile('<svg/>', 'container.svg', 'image/svg+xml')

    expect(revoked).toEqual(urls)
    click.mockRestore()
  })
})
