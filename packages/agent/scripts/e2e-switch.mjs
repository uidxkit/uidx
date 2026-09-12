#!/usr/bin/env node
/**
 * End-to-end exercise: the harness builds a Switch design-system page.
 *
 * This is the task the harness could not do. Asked for a checkbox
 * documentation page in August it produced six frames holding six text
 * labels — 1,237 characters against a 209,648-character exemplar — and
 * declared itself finished. Everything Phase 3 added exists because of some
 * part of that failure, so this script asks for the same shape of thing again
 * and reports, in numbers, how far the harness gets.
 *
 * It is not a unit test and never runs in CI: it needs a real model behind
 * `UIDX_AGENT_URL`, and a run costs minutes. `pnpm test` covers the parts;
 * this covers whether they add up.
 *
 * Run it with the agent service already up:
 *
 *   node packages/agent/scripts/e2e-switch.mjs
 *
 * Options, all environment variables:
 * The service must have been started with the scratch root among its roots,
 * since it only discovers manifests under those:
 *
 *   E2E_ROOT=/tmp/switch-demo
 *   UIDX_AGENT_ROOTS=$E2E_ROOT node packages/agent/dist/server/main.js &
 *   E2E_ROOT=$E2E_ROOT node packages/agent/scripts/e2e-switch.mjs
 *
 *   E2E_ROOT         scratch document root (default a fresh temp directory)
 *   E2E_TURNS        how many Continue turns to allow (default 6)
 *
 * It never runs against `examples/`. An earlier probe against the real
 * exemplar inserted a stray node into `examples/checkbox.uidx`, which is a
 * design file under version control; a scratch root costs nothing and cannot
 * do that.
 */
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const URL_BASE = process.env.UIDX_AGENT_URL ?? 'http://127.0.0.1:4600'
const MAX_TURNS = Number(process.env.E2E_TURNS ?? 6)

/**
 * The manifest id, which is what the service matches on — not the path to
 * `uidx.json`, and not the page. Its other route is "which document holds this
 * page", and the page being built does not exist yet on the first turn, so the
 * id is the only thing that can identify the document here.
 */
const DOC_ID = 'e2e-switch'

/**
 * What the Open UI research says about a Switch, handed over as briefing.
 *
 * The harness has a `web_search` tool and would do this itself, but only with
 * `UIDX_AGENT_SEARCH_PROVIDER` configured; with none, it refuses rather than
 * failing. Pasting the research in is the fallback the Phase 2 spec names, and
 * it keeps this script's result about the *authoring*, which is the part that
 * was broken — not about whether a search key is present.
 *
 * Sources: open-ui.org/components/switch.explainer/ and the Open UI switch
 * research pages, read 2026-08-31.
 */
const RESEARCH = `Research — Open UI, Switch (open-ui.org/components/switch.explainer):

ANATOMY, in Open UI's own part names:
- track: the container, overflow hidden, holding the toggled and untoggled content
- toggled element: revealed in the "on" position
- untoggled element: revealed in the "off" position
- thumb: a separate element that moves across the track and overlaps its edge.
  It sits outside the track in the DOM precisely because it overlaps while the
  track must clip.

STATES:
- checked: "on" | "off", initial "off"
- disabled: true | false, initial false
- focused: true | false, initial false
- There is deliberately NO indeterminate state. That is the sharpest difference
  from a checkbox and should be said out loud on the page.

ROLE AND BEHAVIOUR:
- Native role="switch" per Core Accessibility API Mappings; a labellable element.
- Differs from a checkbox: no indeterminate state, and it takes effect
  immediately with no confirmation step.
- Differs from a radio: it always holds an on/off state (a radio group may be
  unselected), and switches cannot be grouped by a shared name.
- Keyboard: Space toggles. Enter may optionally toggle.

KNOWN PROBLEM worth documenting as an anti-pattern: screen reader
announcements vary wildly by implementation — some announce "checkbox", some
"switch", some nothing useful. Building a switch out of a checkbox without
role="switch" is the specific mistake that causes it.

GEOMETRY CONSTRAINTS Open UI states:
- the thumb must be at least as tall as the track
- content on either side of the track cannot be wider than the thumb`

const TASK = `Build a Switch design-system documentation page at switch-system.uidx.

Work from the component-doc-page skill — load it first, and treat its
REQUIREMENTS as the definition of done. Use the uidx-authoring skill for the
node grammar, and reuse the tokens already in this document rather than
hardcoding values that have names.

${RESEARCH}

Build it a section at a time. Set a plan first, complete each step as you
finish it, and use view_image to check a section before moving on. If you run
out of steps, stop and say which requirements are still outstanding — do not
claim it is done.`

const TOKENS = `---
id: tokens
---

## Core Intent

The scale this page binds to, so a documentation page never hardcodes a value
that already has a name.

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={6} />
    <Variable name="md" type="FLOAT" value={10} />
    <Variable name="pill" type="FLOAT" value={999} />
  </Collection>
  <Collection name="space">
    <Variable name="sm" type="FLOAT" value={8} />
    <Variable name="md" type="FLOAT" value={16} />
    <Variable name="lg" type="FLOAT" value={32} />
  </Collection>
</Tokens>
`

/** A document root the agent may write in freely, seeded with the shelves it reads from. */
async function scratchRoot() {
  const root = process.env.E2E_ROOT ?? (await mkdtemp(join(tmpdir(), 'uidx-e2e-switch-')))
  await mkdir(join(root, '.uidx-agent'), { recursive: true })
  await writeFile(join(root, 'uidx.json'), JSON.stringify({ id: DOC_ID, files: ['**/*.uidx'] }))
  await writeFile(join(root, 'tokens.uidx'), TOKENS)
  for (const shelf of ['skills', 'memory']) {
    await cp(join(REPO, '.uidx-agent', shelf), join(root, '.uidx-agent', shelf), {
      recursive: true,
    })
  }
  return root
}

/** One turn, read off the SSE stream. Returns what the turn did, not how it said it. */
async function turn(root, prompt, taskId) {
  const body = {
    messages: [{ id: `u${Date.now()}`, role: 'user', parts: [{ type: 'text', text: prompt }] }],
    selection: [],
    documentId: DOC_ID,
    page: 'switch-system.uidx',
    ...(taskId ? { taskId } : {}),
  }
  const response = await fetch(`${URL_BASE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:4400' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text()
    // The service only discovers manifests under the roots it was started
    // with, so a scratch root it has never heard of is the likeliest failure
    // here by far — and "404" alone sends a reader looking in the wrong place.
    if (response.status === 404) {
      throw new Error(
        `the agent has no document "${DOC_ID}". It matches on the manifest id, so it has to ` +
          `have discovered this root at startup:\n` +
          `  UIDX_AGENT_ROOTS=${root} node packages/agent/dist/server/main.js`,
      )
    }
    throw new Error(`chat failed: ${response.status} ${detail}`)
  }

  const tools = []
  const refusals = []
  let text = ''
  let meta = {}
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      let event
      try {
        event = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      if (event.type === 'tool-input-available') tools.push(event.toolName)
      if (event.type === 'text-delta') text += event.delta ?? ''
      if (event.type === 'tool-output-available') {
        const out = typeof event.output === 'string' ? event.output : ''
        if (out.startsWith('refused') || out.startsWith('not ')) refusals.push(out.slice(0, 90))
      }
      if (event.type === 'finish') meta = event.messageMetadata ?? {}
    }
  }
  return { tools, refusals, text, meta }
}

/**
 * Which of the skill's requirements the run can be shown to meet.
 *
 * This has been wrong twice, in opposite directions, and both corrections are
 * baked in here. It first looked for `name="states"` anywhere in the source and
 * reported 11 of 17 for a page that was thirteen empty frames — a named empty
 * frame is a section that was named, not one that was built. Then it read only
 * `switch-system.uidx` and reported a component "missing" that the model had
 * put in a file of its own, which is a defensible choice even though the skill
 * asks for it beside the page.
 *
 * So: every `.uidx` the run wrote counts, and a section counts only when the
 * frame named for it holds something.
 *
 * The third correction is `sameName`. Both Haiku runs built the in-context
 * section, named the frame `inContext`, and were marked down for a section
 * they had plainly built — the checklist spells it `in-context`, and an exact
 * match called that missing. Which of `in-context`, `inContext` or `in_context`
 * a model reaches for says nothing about the page, so the comparison ignores
 * case and separators.
 */
const sameName = (a, b) =>
  a.replace(/[-_\s]/g, '').toLowerCase() === b.replace(/[-_\s]/g, '').toLowerCase()

async function coverage(root) {
  const checklist = JSON.parse(
    await readFile(
      join(REPO, '.uidx-agent', 'skills', 'component-doc-page', 'checklist.json'),
      'utf8',
    ),
  )
  const { parse } = await import('@uidx/format')

  const filled = []
  const elements = new Set()
  let chars = 0
  let nodes = 0
  let prose = ''
  const written = []

  for (const name of await readdir(root)) {
    if (!name.endsWith('.uidx') || name === 'tokens.uidx') continue
    const source = await readFile(join(root, name), 'utf8')
    const doc = parse(source).doc
    if (!doc) continue
    written.push(name)
    chars += source.length
    prose += source
    const walk = (node) => {
      nodes += 1
      elements.add(node.element)
      const named = node.attrs?.name?.value
      if (typeof named === 'string' && node.children.length > 0) filled.push(named)
      for (const child of node.children) walk(child)
    }
    walk(doc.tree)
  }

  const heading = (id) => new RegExp(`^##\\s+${id.replace(/-/g, '[ -]')}`, 'im').test(prose)
  const met = checklist.filter((item) =>
    ['core-intent', 'page-structure', 'anti-patterns'].includes(item.id)
      ? heading(item.id)
      : item.id === 'component'
        ? elements.has('Component')
        : item.id === 'variants'
          ? elements.has('Variant')
          : filled.some((name) => sameName(name, item.id)),
  )
  return { checklist, met, chars, nodes, written }
}

/**
 * A throwaway turn, so the long one does not pay for a cold model.
 *
 * Node's fetch aborts a response whose body goes quiet for 300 seconds
 * (`UND_ERR_BODY_TIMEOUT`), and a local runtime that has to page six gigabytes
 * off disk before its first token blows straight through that — which killed a
 * whole run after the model had been swapped out for a hosted one. The warm-up
 * pays that cost against a request nobody is waiting on.
 */
async function warmUp(root) {
  process.stdout.write('warming the model… ')
  const started = Date.now()
  try {
    await turn(root, 'Reply with the single word: ready.', undefined)
    console.log(`${Math.round((Date.now() - started) / 1000)}s`)
  } catch (error) {
    console.log(`failed (${error.message.slice(0, 60)}) — continuing anyway`)
  }
}

async function main() {
  const root = await scratchRoot()
  console.log(`document root: ${root}`)
  console.log(`agent:         ${URL_BASE}`)
  console.log(`turns allowed: ${MAX_TURNS}\n`)

  // Nothing to warm when the run is only scoring what is already there.
  if (MAX_TURNS > 0) await warmUp(root)

  let taskId
  for (let n = 1; n <= MAX_TURNS; n += 1) {
    const started = Date.now()
    const prompt = n === 1 ? TASK : 'Continue. Work the next outstanding plan step.'
    let outcome
    try {
      outcome = await turn(root, prompt, taskId)
    } catch (error) {
      // A dropped stream ends the run rather than the process: whatever was
      // written up to here is still worth measuring.
      console.log(`— turn ${n} died: ${error.message.slice(0, 100)}`)
      break
    }
    const { tools, refusals, text, meta } = outcome
    taskId ??= meta.taskId
    const seconds = Math.round((Date.now() - started) / 1000)

    console.log(
      `— turn ${n} (${seconds}s, ${tools.length} tool calls, plan left ${meta.planRemaining ?? '?'})`,
    )
    console.log(`  tools:    ${[...new Set(tools)].join(', ') || '(none)'}`)
    if (refusals.length > 0) console.log(`  refusals: ${refusals.length}`)
    for (const refusal of refusals.slice(0, 3)) console.log(`    ${refusal}`)
    if (text.trim()) console.log(`  said:     ${text.trim().split('\n')[0].slice(0, 140)}`)

    if (meta.planRemaining === 0 && n > 1) break
  }

  const { checklist, met, chars, nodes, written } = await coverage(root)

  // Every audit over what the model actually produced. None judges whether the
  // design is good — only whether it can be read.
  const { drawsNothing } = await import('../dist/edit/draws-nothing.js')
  const { overlaps } = await import('../dist/edit/overlaps.js')
  const { overflows } = await import('../dist/edit/overflow.js')
  const { tokenFacts } = await import('../dist/edit/token-use.js')
  const { parse } = await import('@uidx/format')
  let blank = 0
  let stacked = 0
  let spilling = 0
  const docs = []
  let pageDoc = null
  for (const name of [...written, 'tokens.uidx']) {
    const doc = parse(await readFile(join(root, name), 'utf8')).doc
    if (!doc) continue
    docs.push(doc)
    if (name === 'switch-system.uidx') pageDoc = doc
    if (name === 'tokens.uidx') continue
    blank += drawsNothing(doc).length
    stacked += overlaps(doc).length
    spilling += overflows(doc).length
  }

  /**
   * The one check that cannot be fooled: draw the thing.
   *
   * Every audit below is a prediction about whether a page renders, and a
   * prediction only covers the failures somebody thought of. A real run proved
   * that the hard way — a page carrying `<Text characters="{radius#pill}" />`
   * passed `uidx check`, passed all three audits, and was reported "renders
   * clean" while `renderToPng` threw on it: the alias resolved to the number
   * 999, and the SDK's font pass walks the whole graph before drawing, so one
   * bad node stopped every pixel. `badAliases` names that specific cause now,
   * but the general answer is not to *predict* rendering when rendering is
   * something this script can simply do.
   */
  const { renderToPng } = await import('../dist/render.js')
  const byName = new Map(docs.map((doc, i) => [[...written, 'tokens.uidx'][i], doc]))
  let renderFailure = null
  try {
    await renderToPng({ docs: byName, file: 'switch-system.uidx', scale: 0.25 })
  } catch (error) {
    renderFailure = error.message.split('\n')[0].slice(0, 120)
  }

  const faults = []
  if (renderFailure) faults.push(`render threw: ${renderFailure}`)
  if (stacked > 0) faults.push(`${stacked} stacked sibling(s)`)
  if (blank > 0) faults.push(`${blank} node(s) drawing nothing`)
  if (spilling > 0) faults.push(`${spilling} node(s) wider than their parent`)
  const verdict = faults.length > 0 ? `DOES NOT RENDER — ${faults.join(', ')}` : 'renders clean'

  console.log(`\nverdict:      ${verdict}`)
  console.log(`requirements: ${met.length}/${checklist.length} built`)
  if (pageDoc)
    console.log(`tokens:       ${(tokenFacts(docs, pageDoc) ?? '- none declared').slice(2)}`)
  console.log(`wrote:        ${written.join(', ') || '(nothing)'}`)
  console.log(`size:         ${chars} characters, ${nodes} nodes`)
  const missing = checklist.filter((item) => !met.includes(item))
  if (missing.length > 0) console.log(`missing:      ${missing.map((m) => m.id).join(', ')}`)
  console.log(`\nread it:      ${join(root, 'switch-system.uidx')}`)
}

await main()
