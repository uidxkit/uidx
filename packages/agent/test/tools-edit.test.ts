import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSchema } from 'ai'
import { afterEach, describe, expect, it } from 'vitest'

import { parse } from '@uidx/format'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { createWriteGate } from '../src/agent/gate.js'
import type { DocumentIndex } from '../src/index/types.js'
import { editTools, isAllowedProp } from '../src/tools/edit.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

const HOME = `---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

/** The checkpoint store insists on a real turn id; the service hands it a UUID. */

const TURN = '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d'

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-agent-tools-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'home.uidx'), HOME)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  const touched: string[] = []
  const tools = editTools({
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: TURN,
    maxFilesPerTurn: 2,
    onFileTouched: (file) => touched.push(file),
  })
  return { root, tools, touched, workspace: open }
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> => {
  const execute = tool.execute as (i: unknown, o: unknown) => Promise<string>
  return execute(input, { toolCallId: 't', messages: [] })
}

describe('edit', () => {
  it('applies a batch and confirms what changed', async () => {
    const { tools, root } = await harness()
    const out = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    })
    expect(out).toMatch(/applied/i)
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toContain('width={800}')
  })

  /**
   * The audit reaches the model at the moment the mistake is cheapest to fix.
   * On the run this comes from, twelve sections were each given the full page
   * width inside a parent that padded them, and the model marked every step
   * done — it had called `review` and looked at a half-scale picture, where a
   * 144px spill is a soft edge.
   */
  it('says so on the spot when a change makes a child wider than its parent', async () => {
    const { tools } = await harness()
    await run(tools.edit, {
      file: 'home.uidx',
      ops: [
        { kind: 'set_prop', address: 'hero', prop: 'paddingLeft', value: 72 },
        { kind: 'set_prop', address: 'hero', prop: 'paddingRight', value: 72 },
      ],
    })
    const out = await run(tools.edit, {
      file: 'home.uidx',
      ops: [
        {
          kind: 'insert_node',
          parent: 'hero',
          node: { element: 'Frame', attrs: { name: 'cover', width: 600, height: 100 } },
        },
      ],
    })
    expect(out).toContain('applied')
    expect(out).toContain('hero#cover is 600 wide inside 456 of space')
  })

  it('hands a refusal back as text the model can act on', async () => {
    const { tools } = await harness()
    const out = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'ghost', prop: 'width', value: 1 }],
    })
    expect(out).toMatch(/ghost/)
    expect(out).toMatch(/not applied|refused|failed/i)
  })

  it('records every file it touched so the turn can be reverted', async () => {
    const { tools, touched } = await harness()
    await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 800 }],
    })
    expect(touched).toEqual(['home.uidx'])
  })

  it('stops once the turn has touched its budget of files', async () => {
    const { tools } = await harness()
    await run(tools.create_file, { file: 'a.uidx', pageId: 'a' })
    await run(tools.create_file, { file: 'b.uidx', pageId: 'b' })
    const out = await run(tools.create_file, { file: 'c.uidx', pageId: 'c' })
    expect(out).toMatch(/budget/i)
  })

  it('does not spend a budget slot on an edit that changes nothing', async () => {
    const { tools } = await harness()
    // hero's width is already 600 — this op nets no textual delta.
    const noop = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'set_prop', address: 'hero', prop: 'width', value: 600 }],
    })
    expect(noop).toMatch(/applied/i)

    // maxFilesPerTurn is 2. If the no-op above had consumed a slot, only one
    // more distinct file could be touched before the budget triggered. It
    // shouldn't have consumed anything, so both of these succeed and the
    // limit is hit only on the third distinct file — exactly where it would
    // land if the no-op had never happened.
    expect(await run(tools.create_file, { file: 'a.uidx', pageId: 'a' })).toMatch(/created/i)
    expect(await run(tools.create_file, { file: 'b.uidx', pageId: 'b' })).toMatch(/created/i)
    expect(await run(tools.create_file, { file: 'c.uidx', pageId: 'c' })).toMatch(/budget/i)
  })
})

describe('create_file and delete_file', () => {
  it('creates a page that parses', async () => {
    const { tools, workspace } = await harness()
    expect(await run(tools.create_file, { file: 'about.uidx', pageId: 'about' })).toMatch(
      /created/i,
    )
    expect(workspace.docOf('about.uidx')).not.toBeNull()
  })

  it('deletes a page', async () => {
    const { tools, workspace } = await harness()
    expect(await run(tools.delete_file, { file: 'home.uidx' })).toMatch(/deleted/i)
    expect(workspace.docOf('home.uidx')).toBeNull()
  })
})

describe('edit input shape', () => {
  // The same regression `plan.test.ts` guards, one level down: an op is an
  // array item, so its fields have to be visible on the item's own root.
  it('gives each op one flat object with every field visible', async () => {
    const { tools } = await harness()
    const schema = asSchema(tools.edit.inputSchema).jsonSchema as {
      properties?: { ops?: { items?: Record<string, unknown> } }
    }
    const item = schema.properties?.ops?.items as {
      type?: string
      oneOf?: unknown
      anyOf?: unknown
      properties?: Record<string, unknown>
    }
    expect(item.type).toBe('object')
    expect(item.oneOf ?? item.anyOf).toBeUndefined()
    expect(Object.keys(item.properties ?? {})).toContain('kind')
    expect(Object.keys(item.properties ?? {})).toContain('address')
    expect(Object.keys(item.properties ?? {})).toContain('node')
  })

  it('refuses an op missing a field its kind needs, without touching the file', async () => {
    const { tools, root, touched } = await harness()
    const before = await readFile(join(root, 'home.uidx'), 'utf8')
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '' }],
    })
    expect(result).toBe('not applied — op 1 (insert_node) needs parent and node')
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(before)
    expect(touched).toEqual([])
  })
})

/**
 * Step 0 is still for orientation. What changed is that the writing tools stay
 * declared through it and refuse in their own words — a tool dropped from
 * `activeTools` came back as "unavailable tool", and a model reading that as
 * "does not exist" gave up on creating pages entirely.
 */
describe('the write gate', () => {
  const gated = async () => {
    const { root, tools: ungated, touched, workspace } = await harness()
    const writeGate = createWriteGate()
    const tools = editTools({
      workspace,
      checkpoints: createCheckpointStore(root),
      globs: ['**/*.uidx'],
      turnId: TURN,
      maxFilesPerTurn: 2,
      onFileTouched: (file) => touched.push(file),
      writeGate,
    })
    return { root, tools, touched, writeGate, ungated }
  }

  it('refuses all three writes while it is shut, each in its own voice', async () => {
    const { tools } = await gated()
    expect(
      await run(tools.edit, { file: 'home.uidx', ops: [{ kind: 'remove_node', address: 'hero' }] }),
    ).toBe(
      'not applied — look at the page first — edit is available from your next step, so call read or search now and edit straight after',
    )
    expect(await run(tools.create_file, { file: 'new.uidx', pageId: 'new' })).toContain(
      'not created — look at the page first',
    )
    expect(await run(tools.delete_file, { file: 'home.uidx' })).toContain(
      'not deleted — look at the page first',
    )
  })

  it('writes nothing and spends no file budget while refusing', async () => {
    const { root, tools, touched } = await gated()
    const before = await readFile(join(root, 'home.uidx'), 'utf8')
    await run(tools.edit, { file: 'home.uidx', ops: [{ kind: 'remove_node', address: 'hero' }] })
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(before)
    expect(touched).toEqual([])
  })

  it('lets the same call through once the gate opens', async () => {
    const { tools, writeGate } = await gated()
    writeGate.open = true
    expect(await run(tools.create_file, { file: 'new.uidx', pageId: 'new' })).toBe(
      'created new.uidx',
    )
  })

  // A tool built with no gate at all is one used outside an orchestrator loop,
  // where there is no step 0 to be early for.
  it('never refuses on these grounds when no gate was given', async () => {
    const { ungated } = await gated()
    expect(await run(ungated.create_file, { file: 'other.uidx', pageId: 'other' })).toBe(
      'created other.uidx',
    )
  })
})

describe('unknown components', () => {
  const indexStub = (names: string[]): DocumentIndex =>
    ({ components: new Map(names.map((name) => [name, { name }])) }) as unknown as DocumentIndex

  const withIndex = async (names: string[]) => {
    const { root, touched, workspace } = await harness()
    const tools = editTools({
      workspace,
      checkpoints: createCheckpointStore(root),
      globs: ['**/*.uidx'],
      turnId: TURN,
      maxFilesPerTurn: 2,
      onFileTouched: (file) => touched.push(file),
      index: indexStub(names),
    })
    return { tools, touched }
  }

  // Rebuilding a component the document already defines is the failure this
  // aims at, so the refusal has to hand back the names worth reusing.
  it('names the components that do exist', async () => {
    const { tools, touched } = await withIndex(['Card', 'Control/Checkbox'])
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '', node: { element: 'Instance', component: 'Crd' } }],
    })
    expect(result).toBe(
      'not applied — op 1 instances "Crd", which no page defines — the document has Card, Control/Checkbox',
    )
    expect(touched).toEqual([])
  })

  it('checks nested children too, not just the node it was handed', async () => {
    const { tools } = await withIndex(['Card'])
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [
        {
          kind: 'insert_node',
          parent: '',
          node: { element: 'Frame', children: [{ element: 'Instance', component: 'Ghost' }] },
        },
      ],
    })
    expect(result).toContain('instances "Ghost"')
  })

  it('lets a known component through', async () => {
    const { tools } = await withIndex(['Card'])
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '', node: { element: 'Instance', component: 'Card' } }],
    })
    expect(result).toContain('applied')
  })

  it('checks nothing when there is no index, so a caller outside a turn still works', async () => {
    const { tools } = await harness()
    const result = await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '', node: { element: 'Instance', component: 'Crd' } }],
    })
    expect(result).toContain('applied')
  })
})

/**
 * Caught red-handed rather than imagined: asked for prose sections it had no
 * tool to write, Claude Sonnet probed for a way in with
 * `<Page coreIntent="test-value-check" intent="TEST-INTENT-CHANGE">` and the
 * harness answered "applied" three times. The page stayed valid, rendered
 * blank, and reported zero errors.
 */
describe('props that no element carries', () => {
  const edit = async (ops: unknown[]) => {
    const { tools } = await harness()
    return run(tools.edit, { file: 'home.uidx', ops })
  }

  it('refuses a prop that is not uidx, and suggests what is', async () => {
    const result = await edit([
      { kind: 'insert_node', parent: '', node: { element: 'Text', copy: 'Hello' } },
    ])
    expect(result).toContain('"copy", which is not a uidx prop')
    expect(result).toContain('characters')
  })

  it('refuses the probe that started this, on set_prop too', async () => {
    expect(
      await edit([{ kind: 'set_prop', address: 'hero', prop: 'coreIntent', value: 'x' }]),
    ).toContain('not a uidx prop')
  })

  it('looks inside nested children, not just the node it was handed', async () => {
    const result = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Frame', children: [{ element: 'Text', label: 'Hi' }] },
      },
    ])
    expect(result).toContain('"label"')
  })

  it('writes nothing when it refuses', async () => {
    const { tools, root, touched } = await harness()
    const before = await readFile(join(root, 'home.uidx'), 'utf8')
    await run(tools.edit, {
      file: 'home.uidx',
      ops: [{ kind: 'insert_node', parent: '', node: { element: 'Text', copy: 'x' } }],
    })
    expect(await readFile(join(root, 'home.uidx'), 'utf8')).toBe(before)
    expect(touched).toEqual([])
  })

  it('lets every real prop through', async () => {
    const result = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: {
          element: 'Frame',
          name: 'card',
          layoutMode: 'VERTICAL',
          cornerRadius: 8,
          children: [{ element: 'Text', name: 't', characters: 'Hi', fontSize: 14 }],
        },
      },
    ])
    expect(result).toContain('applied')
  })

  /**
   * One lowercase letter, measured: `layoutMode="vertical"` sailed through
   * the name check, the engine ignored the value it didn't know, no layout
   * happened, and the section collapsed into a 56px sliver that every audit
   * called clean. A known prop with a value nothing accepts is the same
   * silent failure as an unknown prop, and gets the same refusal.
   */
  it('refuses an enum value the engine would silently ignore', async () => {
    const result = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Frame', name: 'cover', layoutMode: 'vertical' },
      },
    ])
    expect(result).toContain('"vertical" is not a layoutMode')
    expect(result).toContain('did you mean "VERTICAL"?')
  })

  it('refuses it on set_prop too, listing the values when nothing is close', async () => {
    const result = await edit([
      { kind: 'set_prop', address: 'hero', prop: 'layoutMode', value: 'COLUMN' },
    ])
    expect(result).toContain('not a layoutMode')
    expect(result).toContain('NONE, HORIZONTAL, VERTICAL, GRID')
  })

  // A Variant's props are its component's axis names, and the token tree has a
  // vocabulary of its own. Both exemptions came from running this rule over
  // every .uidx in the repo before it shipped.
  it('does not judge a Variant, whose props are axis names', async () => {
    const result = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Variant', state: 'off', size: 'md', anythingTheAuthorChose: 'x' },
      },
    ])
    expect(result).not.toContain('not a uidx prop')
  })

  it('does not judge the token tree, where type and value are real', async () => {
    const result = await edit([
      {
        kind: 'insert_node',
        parent: '',
        node: { element: 'Variable', name: 'md', type: 'FLOAT', value: 8 },
      },
    ])
    expect(result).not.toContain('not a uidx prop')
  })
})

/**
 * A `.uidx` file is prose *and* a tree, and until this existed the harness
 * wrote only the tree. Three of the shipped documentation checklist's
 * seventeen requirements are prose sections, so they were unreachable — which
 * is what sent a frontier model probing for a way in.
 */
describe('set_intent', () => {
  it('replaces the prose above the tree and leaves the tree alone', async () => {
    const { tools, root } = await harness()
    const result = await run(tools.set_intent, {
      file: 'home.uidx',
      body: '## Core Intent\n\nA switch is a binary control.\n\n## Anti-Patterns\n\nNEVER build one from a checkbox.',
    })
    expect(result).toBe('wrote the intent of home.uidx')

    const written = await readFile(join(root, 'home.uidx'), 'utf8')
    expect(written).toContain('## Core Intent')
    expect(written).toContain('NEVER build one from a checkbox.')
    expect(written).toContain('## Visual Contract')
    expect(written).toContain('name="hero"')
  })

  it('leaves a page that still parses, with the tree intact', async () => {
    const { tools, root, workspace } = await harness()
    await run(tools.set_intent, { file: 'home.uidx', body: '## Core Intent\n\nRewritten.' })
    const reparsed = parse(await readFile(join(root, 'home.uidx'), 'utf8'))
    expect(reparsed.doc).toBeTruthy()
    expect(reparsed.doc!.tree.children).toHaveLength(1)
    void workspace
  })

  it('counts as a file touched, so it draws against the same budget a write does', async () => {
    const { tools, touched } = await harness()
    await run(tools.set_intent, { file: 'home.uidx', body: '## Core Intent\n\nx' })
    expect(touched).toEqual(['home.uidx'])
  })

  it('refuses a page it does not have', async () => {
    const { tools } = await harness()
    expect(await run(tools.set_intent, { file: 'ghost.uidx', body: '## X' })).toContain(
      'not written —',
    )
  })

  it('is gated with the other writes, so it cannot run before a look', async () => {
    const { root, touched, workspace } = await harness()
    const tools = editTools({
      workspace,
      checkpoints: createCheckpointStore(root),
      globs: ['**/*.uidx'],
      turnId: TURN,
      maxFilesPerTurn: 2,
      onFileTouched: (file) => touched.push(file),
      writeGate: createWriteGate(),
    })
    expect(await run(tools.set_intent, { file: 'home.uidx', body: '## X' })).toContain(
      'look at the page first',
    )
  })
})

/** Metadata and dynamic props remain valid alongside ordinary visual props. */
describe('prop validation across node types', () => {
  it('accepts component metadata, variant axes, and instance overrides', () => {
    const source = `---
id: props
---

## Visual Contract

<Page>
      <Component name="Button" status="draft" version="1.0.0" props={{ label: { type: 'TEXT', default: 'OK' } }} variants={{ state: ['idle'] }}>
        <Variant state="idle"><Frame name="body" width={120} height={40} layoutMode="HORIZONTAL"><Text name="label" characters="{label}" /></Frame></Variant>
      </Component>
      <Frame name="doc"><Instance name="button" component="Button" props={{ label: 'Continue' }} /></Frame>
    </Page>`
    const result = parse(source)
    expect(result.doc, JSON.stringify(result.diagnostics)).toBeTruthy()
    const offenders: string[] = []
    const walk = (node: NonNullable<typeof result.doc>['tree']): void => {
      for (const prop of Object.keys(node.attrs)) {
        if (!isAllowedProp(node.element, prop)) offenders.push(`<${node.element} ${prop}>`)
      }
      node.children.forEach(walk)
    }
    walk(result.doc!.tree)
    expect(offenders).toEqual([])
  })
})
