import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { evalDocument } from '../src/core/eval.js'
import { openDocument, type OpenedDocument } from '../src/core/index.js'

const PAGE = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="doc" width={1440} paddingLeft={72} paddingRight={72} layoutMode="VERTICAL">
    <Frame name="cover" width={1440} layoutMode="VERTICAL">
      <Text name="title" characters="Switch" fontSize={56} />
    </Frame>
    <Frame name="states" width={1440} layoutMode="VERTICAL">
      <Text name="heading" characters="States" fontSize={32} />
    </Frame>
  </Frame>
</Page>
`

let opened: OpenedDocument | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-eval-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), PAGE)
  opened = await openDocument(root)
  return opened
}

/**
 * The Figma-plugin-API move with this harness's rules kept: a script queries
 * plain data and queues ops; the ops run through the same gated path as every
 * other surface after the script ends. The value is arithmetic — a loop in
 * five lines instead of a read, a hand computation, and thirty structured
 * calls.
 */
describe('evalDocument', () => {
  it('queries with code — predicates no fixed tool verb could offer', async () => {
    const { result } = await evalDocument(
      await harness(),
      `const page = doc('home.uidx')
       return find(page, n => n.element === 'Text' && n.attrs.fontSize > 40).map(n => n.address)`,
    )
    expect(result).toEqual(['doc#cover/title'])
  })

  it('computes and writes in one script — the loop the op language cannot express', async () => {
    const open = await harness()
    const { applied } = await evalDocument(
      open,
      `const page = doc('home.uidx')
       const parent = find(page, n => n.name === 'doc')[0]
       const inner = parent.attrs.width - parent.attrs.paddingLeft - parent.attrs.paddingRight
       const edit = ops('home.uidx')
       for (const child of parent.children) edit.set(child.address, 'width', inner)
       return inner`,
    )
    expect(applied).toEqual([
      { file: 'home.uidx', ok: true, message: expect.stringContaining('applied 2 change(s)') },
    ])
    expect(open.workspace.sourceOf('home.uidx')).toContain('width={1296}')
  })

  /**
   * The whole trick: scripts never mutate directly, so the twelve failure
   * classes stay closed. A script writing the lowercase enum that once
   * collapsed a page is refused in the same words the harness's edit tool
   * uses — and for a while the CLI/MCP apply path skipped these gates, which
   * is why this is a test and not an assumption.
   */
  it('gates queued ops exactly like every other surface', async () => {
    const open = await harness()
    const { applied } = await evalDocument(
      open,
      `ops('home.uidx').set('doc#cover', 'layoutMode', 'vertical')`,
    )
    expect(applied[0]!.ok).toBe(false)
    expect(applied[0]!.message).toContain('not a layoutMode')
    expect(applied[0]!.message).toContain('did you mean "VERTICAL"?')
    expect(open.workspace.sourceOf('home.uidx')).not.toContain('vertical')
  })

  /**
   * The batch that caught a gate bug: define a Component and instance it in
   * the same script — one insert holding the Component with every variant
   * (composed in memory, so the shell-without-variants refusal can never
   * happen), and a grid of instances beside it. unknownComponent used to
   * check only the pre-batch index and refused the whole thing.
   */
  it('lets one script define a component and instance it in the same batch', async () => {
    const open = await harness()
    const { applied } = await evalDocument(
      open,
      `const edit = ops('home.uidx')
       edit.insert('', { element: 'Component', attrs: { name: 'Demo/Chip', x: 900,
         variants: { state: ['off', 'on'] } },
         children: ['off', 'on'].map(state => ({ element: 'Variant', attrs: { state },
           children: [{ element: 'Frame', attrs: { name: 'body', width: 40, height: 20 } }] })) })
       edit.insert('doc#states', { element: 'Instance',
         attrs: { name: 'chip-on', component: 'Demo/Chip', props: { state: 'on' } } })`,
    )
    expect(applied[0]!.ok).toBe(true)
    expect(applied[0]!.message).toContain('applied 2 change(s)')
  })

  it('appends the audits to a successful scripted write', async () => {
    const { applied } = await evalDocument(
      await harness(),
      `ops('home.uidx').insert('', { element: 'Frame', attrs: { name: 'stray' } })`,
    )
    expect(applied[0]!.message).toContain('stray draws nothing')
  })

  it('kills a runaway script rather than hanging the surface', async () => {
    await expect(evalDocument(await harness(), 'for (;;) {}')).rejects.toThrow(/timed out/i)
  })

  it('captures console.log for the agent to read back', async () => {
    const { logs } = await evalDocument(
      await harness(),
      `console.log('nodes:', find(doc('home.uidx'), () => true).length)`,
    )
    expect(logs).toEqual(['nodes: 6'])
  })
})
