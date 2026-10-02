import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { describeComponent } from '../src/core/design-system.js'
import { instanceBoxDocs } from './fixtures/instance-box.js'

/**
 * A coding agent placing a component needs to know how a use may be
 * restyled without touching the component (ADR 0018): which node the outer
 * box lands on, whether that box lays out, and the custom properties the
 * generated code reads it from.
 */
async function styling(name: string) {
  const root = await mkdtemp(join(tmpdir(), 'uidx-styling-'))
  return (await describeComponent(instanceBoxDocs(), root, name)).styling
}

describe("describeComponent's styling (ADR 0018)", () => {
  it("puts Button1's box on the derived root frame, which lays out", async () => {
    const out = await styling('Button1')
    expect(out.box).toEqual({ target: 'frame', node: 'root' })
    expect(out.laysOut).toBe(true)
  })

  it('names the hook generated code reads for every box attribute and textFills', async () => {
    const { hooks } = await styling('Button1')
    expect(hooks).toMatchObject({
      fills: '--uidx-fill',
      strokes: '--uidx-stroke',
      dashPattern: '--uidx-stroke-style',
      strokeWeight: '--uidx-stroke-weight',
      strokeTopWeight: '--uidx-stroke-top-weight',
      cornerRadius: '--uidx-radius',
      topLeftRadius: '--uidx-radius-top-left',
      bottomRightRadius: '--uidx-radius-bottom-right',
      paddingLeft: '--uidx-padding-left',
      opacity: '--uidx-opacity',
      effects: '--uidx-shadow',
      textFills: '--uidx-text-color',
    })
    // Canvas-only: CSS has no form for either.
    expect(hooks).not.toHaveProperty('strokeAlign')
    expect(hooks).not.toHaveProperty('cornerSmoothing')
  })

  it('lists what an <Instance> may restyle, and nothing of the inside', async () => {
    const { attributes } = await styling('Button1')
    expect(attributes).toEqual(expect.arrayContaining(['fills', 'paddingLeft', 'textFills']))
    for (const inside of ['layoutMode', 'itemSpacing', 'fontSize', 'characters'])
      expect(attributes).not.toContain(inside)
    // Placement is the use's own business, not a restyle.
    expect(attributes).not.toContain('x')
  })

  it('puts the box on the instance itself for a component that lays itself out', async () => {
    expect(await styling('Chip')).toMatchObject({ box: { target: 'self' }, laysOut: true })
  })

  it('puts it on the one frame a bare component wraps, or the chosen variant wraps', async () => {
    expect(await styling('Tag')).toMatchObject({
      box: { target: 'frame', node: 'box' },
      laysOut: true,
    })
    expect((await styling('Badge')).box).toEqual({ target: 'frame', node: 'badge' })
  })

  it('passes it to the one instance a composition holds, laid out as that component lays out', async () => {
    expect(await styling('TagField')).toMatchObject({
      box: { target: 'instance', node: 'tag', component: 'Tag' },
      laysOut: true,
    })
  })

  it('lays out a component that declares no geometry, as the canvas draws it: a column', async () => {
    expect(await styling('Caption')).toMatchObject({ box: { target: 'self' }, laysOut: true })
  })

  it('says so when the box lays nothing out, so padding on a use would do nothing', async () => {
    expect(await styling('Dot')).toMatchObject({ box: { target: 'self' }, laysOut: false })
  })
})
