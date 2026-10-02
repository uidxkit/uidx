import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { parse, parseOrThrow, type UidxNode } from '@uidx/format'

import { SYSTEM_PROMPT } from '../src/agent/prompt.js'
import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { narrowOps, type EditOpInput } from '../src/edit/ops.js'
import { editTools, isAllowedProp, refuseBadOps } from '../src/tools/edit.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'
import { BUTTON1 } from './fixtures/instance-box.js'

/**
 * An instance is a black box with a styleable outer box (ADR 0018). The
 * agent may restyle a use's box and the colour of its texts, and is told
 * plainly when it reaches inside: a layout prop on an instance parses, but
 * every target ignores it, so "applied" would be a lie.
 */
const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
  <Instance name="delete" component="Button1" props={{ label: 'Delete' }} />
  <Instance name="legacy" component="Button1" itemSpacing={4} />
  <Text name="caption" characters="Hi" fontSize={12} />
</Page>
`

const RED = [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }]

const TURN = '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d'

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-instance-box-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'button1.uidx'), BUTTON1)
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  const tools = editTools({
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: TURN,
    maxFilesPerTurn: 4,
  })
  const edit = (ops: EditOpInput[]): Promise<string> =>
    (tools.edit.execute as (i: unknown, o: unknown) => Promise<string>)(
      { file: 'home.uidx', ops },
      { toolCallId: 't', messages: [] },
    )
  const home = () => readFile(join(root, 'home.uidx'), 'utf8')
  return { edit, home }
}

const LOCKED_LAYOUT =
  "itemSpacing is Button1's own layout — an instance restyles its outer box (fills, strokes, cornerRadius, opacity, effects, padding) and textFills; change the component or detach"

describe('editing an instance (ADR 0018)', () => {
  it('refuses a layout prop on an Instance, naming the component and what a use can restyle', async () => {
    const { edit, home } = await harness()
    const out = await edit([{ kind: 'set_prop', address: 'delete', prop: 'itemSpacing', value: 8 }])
    expect(out).toContain('not applied')
    expect(out).toContain(LOCKED_LAYOUT)
    expect(await home()).toBe(HOME)
  })

  it('refuses a text property as the inside of the component', async () => {
    const { edit } = await harness()
    const out = await edit([{ kind: 'set_prop', address: 'delete', prop: 'fontSize', value: 20 }])
    expect(out).toContain('not applied')
    expect(out).toContain('fontSize is inside Button1 — an instance restyles its outer box')
  })

  it('applies the outer box and textFills on an Instance', async () => {
    const { edit, home } = await harness()
    const out = await edit([
      { kind: 'set_prop', address: 'delete', prop: 'fills', value: RED },
      { kind: 'set_prop', address: 'delete', prop: 'paddingLeft', value: 24 },
      { kind: 'set_prop', address: 'delete', prop: 'textFills', value: RED },
    ])
    expect(out).toMatch(/^applied 3 change/)
    const written = parseOrThrow(await home())
    const use = written.tree.children.find((node) => node.name === 'delete')!
    expect(Object.keys(use.attrs)).toEqual(
      expect.arrayContaining(['fills', 'paddingLeft', 'textFills']),
    )
  })

  it('refuses textFills on a Frame and on a Text, pointing at the fills of each text', async () => {
    const { edit } = await harness()
    const onFrame = await edit([
      { kind: 'set_prop', address: 'hero', prop: 'textFills', value: RED },
    ])
    expect(onFrame).toContain('not applied')
    expect(onFrame).toContain('textFills goes on an Instance')
    expect(onFrame).toContain('set fills on each Text')
    const onText = await edit([
      { kind: 'set_prop', address: 'caption', prop: 'textFills', value: RED },
    ])
    expect(onText).toContain('a Text takes its colour from its own fills')
  })

  it('judges an inserted Instance by the same rules', async () => {
    const { edit } = await harness()
    const styled = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Instance', name: 'ok', component: 'Button1', fills: RED, textFills: RED },
      },
    ])
    expect(styled).toMatch(/^applied/)
    const laidOut = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Instance', name: 'no', component: 'Button1', layoutMode: 'VERTICAL' },
      },
    ])
    expect(laidOut).toContain("layoutMode is Button1's own layout")
    const framed = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Frame', name: 'card', textFills: RED },
      },
    ])
    expect(framed).toContain('textFills goes on an Instance')
  })

  it('still lets a locked attribute be removed, which is the fix', async () => {
    const { edit, home } = await harness()
    const out = await edit([{ kind: 'remove_prop', address: 'legacy', prop: 'itemSpacing' }])
    expect(out).toMatch(/^applied 1 change/)
    expect(await home()).not.toContain('itemSpacing')
  })

  it('suggests textFills for a text colour, and fills on a Text', async () => {
    const { edit } = await harness()
    for (const prop of ['textColor', 'fontColor']) {
      const out = await edit([{ kind: 'set_prop', address: 'delete', prop, value: RED }])
      expect(out).toContain('did you mean textFills?')
    }
    const onText = await edit([
      { kind: 'set_prop', address: 'caption', prop: 'textColor', value: RED },
    ])
    expect(onText).toContain('did you mean fills?')
  })

  it('refuses the same through the facade the CLI and MCP server write with', () => {
    const doc = parseOrThrow(HOME)
    const narrowed = narrowOps([
      { kind: 'set_prop', address: 'delete', prop: 'itemSpacing', value: 8 },
    ])
    if (!narrowed.ok) throw new Error(narrowed.message)
    expect(refuseBadOps(narrowed.value, undefined, doc)).toContain(LOCKED_LAYOUT)
  })
})

/**
 * A styles-table cell carries a scene prop of the node it targets, so it is
 * judged as a prop on that node would be: a text colour only on a placed
 * component, and nothing of a placed component's inside on one.
 */
describe('a style cell, judged by the node it targets', () => {
  const PANEL = `---
id: panel
---

## Visual Contract

<Page>
  <Component name="Panel" status="draft" layoutMode="VERTICAL">
    <Text name="title" characters="Title" />
    <Instance name="action" component="Button1" />
  </Component>
</Page>
`
  const style = (target: string, prop: string, value: unknown) => {
    const narrowed = narrowOps([
      { kind: 'set_style', keys: { state: 'hover' }, target, prop, value } as EditOpInput,
    ])
    if (!narrowed.ok) throw new Error(narrowed.message)
    return refuseBadOps(narrowed.value, undefined, parseOrThrow(PANEL))
  }

  it('refuses textFills on a text, or on the component’s own frame', () => {
    expect(style('title', 'textFills', RED)).toContain(
      'textFills goes on an Instance, where it colours every text the component draws — a Text takes its colour from its own fills',
    )
    expect(style('root', 'textFills', RED)).toContain('textFills goes on an Instance')
  })

  it('allows the box and textFills on an instance the component holds', () => {
    expect(style('action', 'textFills', RED)).toBeNull()
    expect(style('action', 'fills', RED)).toBeNull()
  })

  it('refuses the inside of the component an instance it holds draws', () => {
    expect(style('action', 'itemSpacing', 8)).toContain(LOCKED_LAYOUT)
  })

  it('judges by name alone a target the page does not have', () => {
    expect(style('nowhere', 'fills', RED)).toBeNull()
    expect(style('nowhere', 'textFill', RED)).toContain('not a uidx prop')
  })
})

describe('isAllowedProp on an Instance (ADR 0018 §1)', () => {
  it('allows placement, the box and textFills, and refuses the inside', () => {
    for (const prop of ['x', 'width', 'fills', 'strokeWeight', 'paddingTop', 'textFills', 'props'])
      expect(isAllowedProp('Instance', prop), prop).toBe(true)
    for (const prop of ['layoutMode', 'itemSpacing', 'clipsContent', 'fontSize', 'vectorPaths'])
      expect(isAllowedProp('Instance', prop), prop).toBe(false)
  })

  it('allows textFills on an Instance alone', () => {
    expect(isAllowedProp('Frame', 'textFills')).toBe(false)
    expect(isAllowedProp('Text', 'textFills')).toBe(false)
    expect(isAllowedProp('Frame', 'itemSpacing')).toBe(true)
  })

  /**
   * ADR 0018 says no file in this repo writes a locked attribute on an
   * instance; this holds it to that. Tracked pages only, so a scratch page in
   * someone's working copy never decides the result.
   */
  it("passes every Instance in the repo's own pages", () => {
    const repo = join(dirname(fileURLToPath(import.meta.url)), '../../..')
    const files = execFileSync('git', ['ls-files', '--', '*.uidx'], { cwd: repo, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    expect(files.length).toBeGreaterThan(0)
    const offenders: string[] = []
    for (const file of files) {
      const { doc } = parse(readFileSync(join(repo, file), 'utf8'))
      if (!doc) continue
      const walk = (node: UidxNode): void => {
        for (const prop of Object.keys(node.attrs))
          if (
            (node.element === 'Instance' || prop === 'textFills') &&
            !isAllowedProp(node.element, prop)
          )
            offenders.push(`${file}: <${node.element} ${prop}>`)
        node.children.forEach(walk)
      }
      walk(doc.tree)
    }
    expect(offenders).toEqual([])
  })
})

describe('the system prompt', () => {
  it('says a use restyles its outer box and text colour, and its inside is the component’s', () => {
    expect(SYSTEM_PROMPT).toMatch(/textFills/)
    expect(SYSTEM_PROMPT).toMatch(/Instance/)
    expect(SYSTEM_PROMPT.length).toBeLessThan(2400)
  })
})
