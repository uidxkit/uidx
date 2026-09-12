import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse, TOKEN_ELEMENTS, type UidxDocument, type UidxNode } from '@uidx/format'
import { isKnownProp } from '@uidx/schema'
import { afterEach, describe, expect, it } from 'vitest'

import { createCheckpointStore } from '../src/edit/checkpoint.js'
import { editTools } from '../src/tools/edit.js'
import { discoverManifests } from '../src/workspace/discover.js'
import { openWorkspace, type Workspace } from '../src/workspace/workspace.js'

/**
 * Can the tool surface express a good page at all?
 *
 * This builds a page through nothing but `create_file`, `set_intent` and
 * `edit` — the same three tools the model has — and asserts every step lands.
 * No model is involved, it costs nothing, and it runs in CI.
 *
 * The reasoning is that a scripted caller which knows exactly what it wants is
 * the best case: if *it* cannot get there, no model can, and the failure is
 * the harness's rather than the model's. Three blockers were found the
 * expensive way before this existed — the harness could not write prose at
 * all, unknown props were accepted silently, and `insert_node` of a `<Variant>`
 * could never succeed because the compiler named it and the validator rejected
 * the name. Each took a paid frontier-model run to surface and seconds to
 * reproduce. This is where the next one gets caught instead.
 *
 * **It is not a page for the agent to copy, and the agent never sees it.**
 * The content here is deliberately thin — one section, one component, one
 * instance — because it is a capability exercise, not a design. What a good
 * Switch page looks like is the model's problem; whether the tools can express
 * one is this file's.
 */

let open: Workspace | null = null
afterEach(async () => {
  await open?.close()
  open = null
})

const TOKENS = `---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="pill" type="FLOAT" value={999} />
  </Collection>
</Tokens>
`

async function surface() {
  const root = await mkdtemp(join(tmpdir(), 'uidx-surface-'))
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
  await writeFile(join(root, 'tokens.uidx'), TOKENS)
  const [found] = await discoverManifests([root])
  open = await openWorkspace(found!)
  const tools = editTools({
    workspace: open,
    checkpoints: createCheckpointStore(root),
    globs: ['**/*.uidx'],
    turnId: '7d1f0a2c-4b3e-4f6a-9c8d-0e1f2a3b4c5d',
    maxFilesPerTurn: 12,
  })
  return { root, tools }
}

const run = async (tool: { execute?: unknown }, input: unknown): Promise<string> =>
  (tool.execute as (i: unknown, o: unknown) => Promise<string>)(input, {
    toolCallId: 't',
    messages: [],
  })

/** Every step must succeed; a refusal anywhere is a capability the tools lack. */
const mustApply = (result: string, step: string): void => {
  expect(result, `${step} was refused: ${result}`).not.toMatch(/^not |^refused/)
}

const walk = (node: UidxNode, visit: (n: UidxNode) => void): void => {
  visit(node)
  for (const child of node.children) walk(child, visit)
}

describe('the tool surface can build a documentation page', () => {
  it('gets from nothing to a page with prose, sections, a component and an instance', async () => {
    const { root, tools } = await surface()
    const file = 'switch.uidx'

    mustApply(await run(tools.create_file, { file, pageId: 'switch' }), 'create_file')

    // The prose half of the format. Unreachable until `set_intent` existed,
    // which is what sent a frontier model probing for a way in.
    mustApply(
      await run(tools.set_intent, {
        file,
        body: [
          '## Core Intent',
          '',
          'A binary control that takes effect immediately.',
          '',
          '## Anti-Patterns',
          '',
          '- NEVER build one from a checkbox without role="switch".',
        ].join('\n'),
      }),
      'set_intent',
    )

    // A section with real geometry, a token alias, and text that says something.
    mustApply(
      await run(tools.edit, {
        file,
        ops: [
          {
            kind: 'insert_node',
            parent: '',
            node: {
              element: 'Frame',
              name: 'doc',
              layoutMode: 'VERTICAL',
              itemSpacing: 24,
              paddingTop: 32,
              children: [
                {
                  element: 'Frame',
                  name: 'overview',
                  layoutMode: 'VERTICAL',
                  cornerRadius: '{radius#pill}',
                  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
                  children: [
                    { element: 'Text', name: 'title', characters: 'Switch', fontSize: 32 },
                  ],
                },
              ],
            },
          },
        ],
      }),
      'insert a section',
    )

    // A component declaring axes must arrive holding a Variant for each
    // (UIDX121), so the whole tree lands in one op — which only works because
    // the variants inside it are unnamed (UIDX118).
    mustApply(
      await run(tools.edit, {
        file,
        ops: [
          {
            kind: 'insert_node',
            parent: '',
            node: {
              element: 'Component',
              name: 'Control/Switch',
              status: 'draft',
              variants: { checked: ['off', 'on'] },
              children: [
                {
                  element: 'Variant',
                  checked: 'off',
                  children: [{ element: 'Frame', name: 'row', layoutMode: 'HORIZONTAL' }],
                },
                {
                  element: 'Variant',
                  checked: 'on',
                  children: [{ element: 'Frame', name: 'row', layoutMode: 'HORIZONTAL' }],
                },
              ],
            },
          },
        ],
      }),
      'insert a component with variants',
    )

    // A states grid is built from instances, so instancing has to work.
    mustApply(
      await run(tools.edit, {
        file,
        ops: [
          {
            kind: 'insert_node',
            parent: 'doc#overview',
            node: {
              element: 'Instance',
              name: 'sample',
              component: 'Control/Switch',
              props: { checked: 'on' },
            },
          },
        ],
      }),
      'insert an instance',
    )

    mustApply(
      await run(tools.edit, {
        file,
        ops: [
          { kind: 'set_prop', address: 'doc#overview/title', prop: 'fontWeight', value: 'BOLD' },
        ],
      }),
      'set a prop on something already there',
    )

    // What the tools produced has to be a document uidx itself accepts.
    const source = await readFile(join(root, file), 'utf8')
    const { doc, diagnostics } = parse(source)
    expect(diagnostics.filter((d) => d.severity !== 'warning')).toEqual([])
    expect(doc).toBeTruthy()

    const page = doc as UidxDocument
    expect(source).toContain('## Core Intent')
    expect(source).toContain('## Anti-Patterns')

    const elements: string[] = []
    walk(page.tree, (node) => elements.push(node.element))
    expect(elements).toContain('Component')
    expect(elements).toContain('Variant')
    expect(elements).toContain('Instance')

    // And it has to pass the rule `uidx check` applies, since a page the
    // harness built should not warn where a hand-authored one would not.
    const unknown: string[] = []
    walk(page.tree, (node) => {
      if (TOKEN_ELEMENTS.has(node.element) || node.element === 'Variant') return
      for (const prop of Object.keys(node.attrs)) {
        if (!isKnownProp(prop) && !['name', 'status', 'variants', 'version'].includes(prop)) {
          unknown.push(`<${node.element} ${prop}=…>`)
        }
      }
    })
    expect(unknown).toEqual([])
  })

  /**
   * The capabilities a documentation page needs, listed rather than assumed.
   * A tool that cannot be reached from here is one the model cannot reach
   * either, which is exactly how `set_intent` came to be missing for a month.
   */
  it('offers a tool for every kind of change such a page needs', async () => {
    const { tools } = await surface()
    expect(Object.keys(tools).sort()).toEqual(['create_file', 'delete_file', 'edit', 'set_intent'])
  })
})
