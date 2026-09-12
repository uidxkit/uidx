#!/usr/bin/env node
/**
 * End-to-end exercise, phased: architecture first, then one section per turn,
 * each gated by arithmetic before the next begins.
 *
 * `e2e-switch.mjs` asks for the whole page in one prompt and lets the model
 * steer every turn. Measured across four runs, that shape spent roughly half
 * its turns re-orienting — re-reading the plan the prompt already carried,
 * re-reading the page it wrote last turn — and let decisions drift between
 * sections because nothing held them still. This driver moves the outer loop
 * into code, which is the workflows-over-agents rule: the task's shape is
 * known (a checklist), so the harness owns the iteration and the model owns
 * exactly one section at a time.
 *
 *   phase 0   one turn: declare the architecture via the architect tool
 *             (components + axes, token plan by tier, section order) — the
 *             gate inside the tool refuses architectures with named gaps
 *   phase 1   one turn per section, briefed from the stored architecture;
 *             after each, the audits and a real render run here, and a
 *             failing section gets exactly one retry carrying the audit text
 *   phase 2   one closing turn for the prose (intent) and a final report
 *
 * Same environment variables and same scratch-root discipline as
 * `e2e-switch.mjs`; see its header. Never runs against `examples/`.
 */
import { mkdtemp, mkdir, cp, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..')
const URL_BASE = process.env.UIDX_AGENT_URL ?? 'http://127.0.0.1:4600'
const DOC_ID = 'e2e-switch'

/** Same research handed to the single-prompt driver, so the two are comparable. */
const SWITCH_RESEARCH = `Research — Open UI, Switch (open-ui.org/components/switch.explainer):

ANATOMY, in Open UI's own part names:
- track: the container, overflow hidden, holding the toggled and untoggled content
- toggled element: revealed in the "on" position
- untoggled element: revealed in the "off" position
- thumb: a separate element that moves across the track and overlaps its edge.

STATES:
- checked: "on" | "off", initial "off"
- disabled: true | false, initial false
- focused: true | false, initial false
- There is deliberately NO indeterminate state — the sharpest difference from a checkbox.

ROLE AND BEHAVIOUR:
- Native role="switch"; a labellable element. Takes effect immediately, no confirmation.
- Differs from a radio: always holds an on/off state; switches cannot be grouped.
- Keyboard: Space toggles. Enter may optionally toggle.

KNOWN PROBLEM worth an anti-pattern: screen readers announce switches built
from checkboxes without role="switch" inconsistently.

GEOMETRY: the thumb must be at least as tall as the track; content beside the
track cannot be wider than the thumb.`

const CHECKBOX_RESEARCH = `Research — Open UI, Checkbox (open-ui.org/components/checkbox.explainer):

ANATOMY, in Open UI's own part names:
- the box: the square control surface, softly rounded
- the mark: the checkmark (checked) or the horizontal bar (indeterminate),
  drawn inside the box, never outside it
- the label: a labellable element beside the box; clicking it toggles the box

STATES:
- checked: true | false, initial false
- indeterminate: true | false — the sharpest difference from a switch: a
  checkbox HAS a third visual state, set only from script, shown as a bar.
  Checking or unchecking clears it.
- disabled: true | false; focused: true | false

ROLE AND BEHAVIOUR:
- Native role="checkbox" with aria-checked "true" | "false" | "mixed".
- A checkbox asks a question the user answers and submits later — unlike a
  switch, which takes effect immediately. Groups of checkboxes are ordinary;
  a parent checkbox may show indeterminate while its children are mixed.
- Keyboard: Space toggles. Clicking the label toggles.

KNOWN PROBLEM worth an anti-pattern: hiding the native input and rebuilding
the box in CSS without keeping focus visible — keyboard users lose the ring.

GEOMETRY: the box is square; the mark is inset within the box and never
touches its edge; the label baseline aligns with the box centre.`

/**
 * Which component this run documents. The flow is identical; only the brief
 * changes — which is the point: the harness carries no component knowledge,
 * and a second component in the same document is the test of the first one's
 * design.md being worth anything.
 */
const COMPONENTS = {
  switch: {
    title: 'Switch',
    page: 'switch-system.uidx',
    explainer: 'https://open-ui.org/components/switch.explainer/',
    research: SWITCH_RESEARCH,
  },
  checkbox: {
    title: 'Checkbox',
    page: 'checkbox-system.uidx',
    explainer: 'https://open-ui.org/components/checkbox.explainer/',
    research: CHECKBOX_RESEARCH,
  },
}
const SUBJECT = COMPONENTS[process.env.E2E_COMPONENT ?? 'switch']
if (!SUBJECT) {
  console.error(`unknown E2E_COMPONENT — one of: ${Object.keys(COMPONENTS).join(', ')}`)
  process.exit(2)
}
const PAGE = SUBJECT.page
const RESEARCH = SUBJECT.research

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

async function scratchRoot() {
  const root = process.env.E2E_ROOT ?? (await mkdtemp(join(tmpdir(), 'uidx-e2e-arch-')))
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

/** One turn, read off the SSE stream — same protocol as e2e-switch.mjs. */
async function turn(root, prompt, taskId) {
  const body = {
    messages: [{ id: `u${Date.now()}`, role: 'user', parts: [{ type: 'text', text: prompt }] }],
    selection: [],
    documentId: DOC_ID,
    page: PAGE,
    ...(taskId ? { taskId } : {}),
  }
  const response = await fetch(`${URL_BASE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:4400' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const detail = await response.text()
    if (response.status === 404) {
      throw new Error(
        `the agent has no document "${DOC_ID}" — start it with UIDX_AGENT_ROOTS=${root}`,
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
        if (out.startsWith('refused') || out.startsWith('not ')) refusals.push(out.slice(0, 110))
      }
      if (event.type === 'finish') meta = event.messageMetadata ?? {}
    }
  }
  return { tools, refusals, text, meta }
}

/** The audits and a real render over the page as it stands — the section gate. */
async function inspect(root) {
  const { parse } = await import('@uidx/format')
  const { drawsNothing } = await import('../dist/edit/draws-nothing.js')
  const { overlaps } = await import('../dist/edit/overlaps.js')
  const { overflows } = await import('../dist/edit/overflow.js')
  const { badAliases } = await import('../dist/edit/alias-types.js')
  const { fixedWithoutSize } = await import('../dist/edit/sizing.js')
  const { missingGlyphs } = await import('../dist/edit/missing-glyphs.js')
  const { renderToPng } = await import('../dist/render.js')

  const docs = new Map()
  for (const name of await readdir(root)) {
    if (!name.endsWith('.uidx')) continue
    const doc = parse(await readFile(join(root, name), 'utf8')).doc
    if (doc) docs.set(name, doc)
  }
  const page = docs.get(PAGE)
  if (!page) return { faults: ['the page does not exist yet'], docs }

  const all = [...docs.values()]
  const faults = []
  for (const address of drawsNothing(page)) faults.push(`${address} draws nothing`)
  for (const [a, b] of overlaps(page)) faults.push(`${a} and ${b} have no position (stacked)`)
  for (const o of overflows(page)) {
    faults.push(`${o.address} is ${o.width} wide inside ${o.inner} — overflows its parent`)
  }
  for (const b of badAliases(all, page)) {
    faults.push(
      `${b.address} binds ${b.target} into ${b.prop} (${JSON.stringify(b.got)} is not text)`,
    )
  }
  for (const c of fixedWithoutSize(page)) {
    faults.push(
      `${c.address} says ${c.axis}="FIXED" but has no ${c.dimension} — the layout collapses`,
    )
  }
  for (const m of await missingGlyphs(page)) {
    faults.push(
      `${m.address} uses ${m.chars.join(' ')} — no glyph in the bundled fonts, draws as nothing`,
    )
  }
  try {
    await renderToPng({ docs, file: PAGE, scale: 0.25 })
  } catch (error) {
    faults.push(`render threw: ${error.message.split('\n')[0].slice(0, 100)}`)
  }
  return { faults, docs }
}

/** Whether the page defines the named component, with at least one variant. */
async function hasComponent(root, name) {
  const { parse } = await import('@uidx/format')
  try {
    const doc = parse(await readFile(join(root, PAGE), 'utf8')).doc
    if (!doc) return false
    return doc.tree.children.some(
      (child) =>
        child.element === 'Component' &&
        child.name === name &&
        child.children.some((grandchild) => grandchild.element === 'Variant'),
    )
  } catch {
    return false
  }
}

/** Loose name equality — `inContext` covers `in-context`; spelling says nothing about the page. */
const sameLoose = (a, b) =>
  a.replace(/[-_\s]/g, '').toLowerCase() === b.replace(/[-_\s]/g, '').toLowerCase()

/**
 * The states-grid gate: the marquee section, judged by arithmetic.
 *
 * Definitions succeeded in every run while this section under-delivered in
 * every run — absent, empty, or a thin row-set — and no geometry audit can
 * demand richness. This one can, because the component itself says what rich
 * means: every designed <Variant> deserves an <Instance> in the grid, and a
 * combination nobody designed gets a "not designed" cell, never a blank.
 */
async function statesGate(root) {
  const { parse } = await import('@uidx/format')
  const doc = parse(await readFile(join(root, PAGE), 'utf8')).doc
  if (!doc) return ['the page does not parse']
  const component = doc.tree.children.find((c) => c.element === 'Component')
  if (!component) return ['no <Component> on the page for the grid to instance']
  const variants = component.children.filter((c) => c.element === 'Variant').length

  let states = null
  const find = (node) => {
    const name = node.attrs?.name?.value
    if (typeof name === 'string' && sameLoose(name, 'states')) states = node
    for (const child of node.children) find(child)
  }
  find(doc.tree)
  if (!states) return [`no frame named "states" on the page`]

  let instances = 0
  const count = (node) => {
    if (node.element === 'Instance' && node.attrs?.component?.value === component.name)
      instances += 1
    for (const child of node.children) count(child)
  }
  count(states)
  const faults = []
  if (instances === 0) faults.push(`the states frame holds no <Instance> of ${component.name}`)
  else if (instances < variants) {
    faults.push(
      `the states grid shows ${instances} instance(s) of ${component.name}, but the component designs ${variants} variants — every designed cell deserves its instance`,
    )
  }
  return faults
}

/** The stored architecture, read the way the server stores it. */
async function readArchitecture(root, taskId) {
  try {
    return JSON.parse(
      await readFile(join(root, '.uidx-agent/architecture', `${taskId}.json`), 'utf8'),
    )
  } catch {
    return null
  }
}

const stamp = (started) => `${Math.round((Date.now() - started) / 1000)}s`

async function main() {
  const root = await scratchRoot()
  console.log(`document root: ${root}`)
  console.log(`agent:         ${URL_BASE}\n`)

  const runStarted = Date.now()
  let taskId

  // ---- phase 0: look, then decide ------------------------------------------
  // Research comes *before* the architecture, so what was seen can be written
  // down while it is still in view. The first ordering lost it: a model
  // studied three real switches, its own later screenshots evicted them, and
  // it drew from prose again — thumb floating mid-track, an anatomy *name*
  // literalised into a visible dot. Vision has to become language while the
  // pictures are still there to describe.
  {
    const started = Date.now()
    const { tools, refusals, text, meta } = await turn(
      root,
      `You are about to build a ${SUBJECT.title} design-system documentation page. Before deciding anything, look at real examples. Fetch ${SUBJECT.explainer} with fetch_url — it lists the images it carries. Then fetch 2 or 3 of those image URLs and study each: every visible part, what draws on top of what, where each part rests in each state, proportions as ratios. Then say in two sentences what you learned.

If up to three DECISIONS would materially change what you build — how many sizes, an extra axis, a brand colour, density — ask them now as short numbered questions and stop; they will be answered before you architect. Do not ask about things the research already settles.`,
      taskId,
    )
    taskId ??= meta.taskId
    const fetched = tools.filter((t) => t === 'fetch_url').length
    console.log(
      `— visual research (${stamp(started)}, ${fetched} fetch(es), ${refusals.length} refusal(s))`,
    )
    // A designer asks before committing; a generator never does. In the panel
    // a human answers — here, E2E_ANSWERS stands in, and the default answers
    // are deliberately opinionated so the run keeps moving.
    if (/\?/.test(text)) {
      const questions = text
        .split('\n')
        .filter((line) => line.includes('?'))
        .slice(0, 3)
      for (const q of questions) console.log(`  asked: ${q.trim().slice(0, 110)}`)
      const answers =
        process.env.E2E_ANSWERS ??
        'Answers: two sizes (md and sm); no extra axes beyond the research; no brand colour — propose a restrained neutral-plus-one-accent palette yourself; comfortable density.'
      const answered = Date.now()
      await turn(root, `${answers}\n\nProceed with these decisions.`, taskId)
      console.log(`  answered (${stamp(answered)})`)
    }
  }

  const architectPrompt = `You are building a ${SUBJECT.title} design-system documentation page at ${PAGE}, working from the component-doc-page skill (load it first) and the uidx-authoring skill.

If this document already holds other component pages, read one first — its ## Design section and its structure are the house style: match its section shapes, bind the same token collections, and let your related section instance its component rather than drawing lookalikes.

${RESEARCH}

This turn, do NOT build anything. Decide and declare the architecture with the architect tool:
- the component(s) with every variant axis and value, and their props
- which token collections you will bind, at which tier — the document already declares radius and space; anything else, mark declare
- every canvas section in build order, one line each on what it holds
- the geometry and behaviour constraints the research states, as constraints — what the research constrains, the building must obey
- as appearance: what the reference images you just studied actually look like, in your own words — every visible part, what draws on top of what, where parts rest in each state, proportions as ratios. This is the visual spec every later step draws from; write it while the pictures are still in view.

If the architect tool refuses, fix what it names and set it again. When it is set, stop.`

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const started = Date.now()
    const { tools, refusals, meta } = await turn(root, architectPrompt, taskId)
    taskId ??= meta.taskId
    console.log(`— architecture attempt ${attempt} (${stamp(started)}, ${tools.length} tool calls)`)
    for (const refusal of refusals.slice(0, 3)) console.log(`    ${refusal}`)
    if (await readArchitecture(root, taskId)) break
  }
  const architecture = await readArchitecture(root, taskId)
  if (!architecture) {
    console.log('\nno architecture was set in two turns — stopping here.')
    return
  }
  console.log(`  sections: ${architecture.sections.map((s) => s.name).join(', ')}`)
  console.log(
    `  tokens:   ${architecture.tokens.map((t) => `${t.collection}${t.tier ? `/${t.tier}` : ''}`).join(', ') || '(none)'}`,
  )
  console.log(`  appearance: ${architecture.appearance?.length ?? 0} line(s)\n`)

  // ---- phase 0.5: the components, before any section needs them -----------
  // Learned from the first phased run: components sit *beside* the page, not
  // in the section list, so a driver that only walks sections never asks for
  // them. The architecture declared Control/Switch with three axes; nothing
  // built it; the states section's <Instance> ops were then rightly refused
  // ("no page defines it") and the section came out an empty, sized frame no
  // audit could fault. The decisions were sound — the driver forgot a phase.
  for (const component of architecture.components) {
    const axes = component.axes.map((axis) => `${axis.name}: ${axis.values.join(' | ')}`).join('; ')
    const appearance =
      architecture.appearance?.length > 0
        ? `\n\nHow it looks — your own visual spec, written while the references were in view; draw what these words say:\n${architecture.appearance.map((line) => `- ${line}`).join('\n')}`
        : ''
    const constraints =
      architecture.constraints?.length > 0
        ? `${appearance}\n\nThe research constrains the geometry — obey these, and check your drawing against the reference images you studied:\n${architecture.constraints.map((c) => `- ${c}`).join('\n')}`
        : appearance
    const componentBrief = `Build the <Component name="${component.name}"> in ${PAGE} — a page child, never inside another frame, with x={1700} so its variant grid sits beside the doc frame rather than drawing underneath it.

Exactly these variant axes, from the architecture: ${axes}. One <Variant> per designed cell, keyed by every axis, each holding a single child Frame with the layout. Props: ${component.props.map((p) => `${p.name} (${p.type})`).join(', ') || '(none)'}. Bind tokens for numbers that have names.${constraints}

Load the uidx-eval-api skill first, then use the eval tool: ONE small script that composes the whole <Component> with EVERY <Variant> as nested data — loops over the axes, geometry computed per variant from your visual spec — and inserts it in a single op. A Component composed in memory can never be refused for holding no variants, and a script never runs out of steps. Build only the component this turn. Then review it — compare what you drew against the real controls you looked at: does the thumb sit where a real one sits, at the size a real one is? Fix what disagrees, and stop.`

    const started = Date.now()
    const { tools, refusals } = await turn(root, componentBrief, taskId)
    const built = await hasComponent(root, component.name)
    console.log(
      `— component ${component.name} (${stamp(started)}, ${tools.length} calls, ${refusals.length} refusal(s)) ${built ? 'defined' : 'MISSING'}`,
    )
    // The texts, not just the count: a component phase that lands nothing
    // twice can only be diagnosed from what was refused, and a run that
    // happened while nobody was printing these is a run that has to be paid
    // for again.
    for (const refusal of refusals.slice(0, 4)) console.log(`    ${refusal}`)
    if (!built) {
      const retryStarted = Date.now()
      await turn(
        root,
        `${PAGE} still defines no <Component name="${component.name}"> — the architecture requires it and the states grid will instance it. Define it now, as a page child, and stop.`,
        taskId,
      )
      console.log(
        `  retry (${stamp(retryStarted)}): ${(await hasComponent(root, component.name)) ? 'defined' : 'still missing'}`,
      )
    }

    // The component's design.md, written into its page the moment it exists:
    // the model-authored decisions (appearance, constraints, token plan),
    // assembled by the harness under Google Labs' DESIGN.md convention as a
    // `## Design` intent section. A later task's architect call reads it back
    // and says "follow it" — one page's research becomes the system's memory.
    if (await hasComponent(root, component.name)) {
      const { renderDesignSection, spliceDesignSection } = await import('../dist/plan/design-md.js')
      const path = join(root, PAGE)
      const spliced = spliceDesignSection(
        await readFile(path, 'utf8'),
        renderDesignSection(architecture, component),
      )
      await writeFile(path, spliced)
      console.log(`  design.md written into ${PAGE}`)
    }
  }

  // ---- phase 0.7: the states grid, with the component fresh ---------------
  // The marquee section gets what fixed the component: its own phase, right
  // after the definitions it instances, and a gate the component itself
  // defines — one <Instance> per designed <Variant>.
  {
    const component = architecture.components[0]
    const gridBrief = `Build the "states" section of ${PAGE}, inside the doc frame in its planned position: a labelled grid of <Instance component="${component?.name}"> cells. Use the eval tool (load the uidx-eval-api skill if you have not): one small script that reads the component's variants from doc(), then generates the grid as a map over the axes — a header row naming each interaction, a labelled row per state and size, one <Instance> with the right props per designed variant, and a plain <Text characters="not designed" width={90} /> in any combination nobody designed. Never a blank cell, never a drawing imitating an instance. Bind tokens for gaps. Build only this section, then stop.`
    const started = Date.now()
    const { tools, refusals } = await turn(root, gridBrief, taskId)
    let faults = await statesGate(root)
    console.log(
      `— states grid (${stamp(started)}, ${tools.length} calls, ${refusals.length} refusal(s)) ${faults.length === 0 ? 'ok' : `${faults.length} fault(s)`}`,
    )
    for (const refusal of refusals.slice(0, 3)) console.log(`    ${refusal}`)
    if (faults.length > 0) {
      const retryStarted = Date.now()
      await turn(
        root,
        `The states grid of ${PAGE} is not done:\n${faults.map((f) => `- ${f}`).join('\n')}\nFix exactly this and stop.`,
        taskId,
      )
      faults = await statesGate(root)
      console.log(
        `  retry (${stamp(retryStarted)}): ${faults.length === 0 ? 'clean' : faults.join('; ')}`,
      )
    }
  }

  // ---- phase 1: one section per turn, gated -------------------------------
  for (const section of architecture.sections.filter((s) => !sameLoose(s.name, 'states'))) {
    const brief = `Build ONE section of ${PAGE}: "${section.name}" — ${section.holds}.

Follow the stored architecture exactly — its component axes and its token plan. Bind tokens for numbers that have names; never bind a token into characters. Use the edit tool; check your work with review once; complete the matching plan step if one exists. Do not touch other sections. When ${section.name} is built, stop.`

    const started = Date.now()
    const { tools, refusals } = await turn(root, brief, taskId)
    const { faults, docs } = await inspect(root)
    const mine = faults.filter((fault) => fault.includes(section.name))
    // A sized, empty frame passes every audit — `drawsNothing` deliberately
    // counts a width as visible — but a section that was *just built* holding
    // nothing is not built. Learned from the first phased run, where states
    // gated "ok" as exactly that.
    const page = docs.get(PAGE)
    const holds = (node) =>
      node.attrs?.name?.value === section.name
        ? node.children.length > 0
        : node.children.some(holds)
    if (page && !holds(page.tree))
      mine.push(`the ${section.name} frame is empty — nothing was built in it`)
    const status = mine.length === 0 ? 'ok' : `${mine.length} fault(s)`
    console.log(
      `— ${section.name} (${stamp(started)}, ${tools.length} calls, ${refusals.length} refusal(s)) ${status}`,
    )

    if (mine.length > 0) {
      // One retry, carrying exactly what the arithmetic found.
      const retryStarted = Date.now()
      await turn(
        root,
        `The ${section.name} section of ${PAGE} has measurable faults:\n${mine.map((f) => `- ${f}`).join('\n')}\nFix these exact faults and stop.`,
        taskId,
      )
      const after = await inspect(root)
      const left = after.faults.filter((fault) => fault.includes(section.name))
      const afterPage = after.docs.get(PAGE)
      if (afterPage && !holds(afterPage.tree)) left.push('still empty')
      console.log(
        `  retry (${stamp(retryStarted)}): ${left.length === 0 ? 'clean' : `${left.length} fault(s) remain`}`,
      )
    }
  }

  // ---- phase 2: prose + wrap-up -------------------------------------------
  const proseStarted = Date.now()
  await turn(
    root,
    `Write the intent prose of ${PAGE} with set_intent: ## Core Intent, ## Page Structure, ## Anti-Patterns — concrete, from the research and the architecture. The page already carries a ## Design section: include it unchanged in what you write, since set_intent replaces the whole intent. Then review the whole page once and stop.`,
    taskId,
  )
  console.log(`— prose + final review (${stamp(proseStarted)})`)

  // Insurance for the design.md: `set_intent` replaces the whole intent, and
  // a model told to keep a section is a model that usually keeps it. The
  // splice is idempotent and the content is deterministic, so re-writing it
  // costs nothing and cannot lose.
  {
    const { renderDesignSection, spliceDesignSection } = await import('../dist/plan/design-md.js')
    const path = join(root, PAGE)
    const spliced = spliceDesignSection(
      await readFile(path, 'utf8'),
      renderDesignSection(architecture, architecture.components[0]),
    )
    await writeFile(path, spliced)
  }

  /** Coverage against the skill's checklist — the same scoring e2e-switch.mjs reports. */
  const scoreCoverage = async () => {
    const { docs } = await inspect(root)
    const checklist = JSON.parse(
      await readFile(join(REPO, '.uidx-agent/skills/component-doc-page/checklist.json'), 'utf8'),
    )
    const sameName = (a, b) =>
      a.replace(/[-_\s]/g, '').toLowerCase() === b.replace(/[-_\s]/g, '').toLowerCase()
    const filled = []
    const elements = new Set()
    let chars = 0
    let nodes = 0
    let prose = ''
    for (const [name, doc] of docs) {
      if (name === 'tokens.uidx') continue
      const source = await readFile(join(root, name), 'utf8')
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
    const missing = checklist.filter((item) => !met.includes(item))
    return { checklist, met, missing, chars, nodes }
  }

  // ---- phase 3: the completion sweep --------------------------------------
  // A section that took a fault its one retry did not clear, or a step that
  // quietly under-delivered, surfaces here as a missing checklist item — and
  // gets exactly one more targeted turn. Measured need: a run scored 16/17
  // with a states grid its retry left empty, and nothing downstream ever
  // returned to it.
  for (const item of (await scoreCoverage()).missing.slice(0, 3)) {
    const started = Date.now()
    await turn(
      root,
      `${PAGE} is complete except for one requirement, which is missing or empty: ${item.id} — ${item.requirement}. Build exactly that, following the stored architecture and the page's ## Design section, and stop.`,
      taskId,
    )
    const closed = !(await scoreCoverage()).missing.some((left) => left.id === item.id)
    console.log(`— sweep ${item.id} (${stamp(started)}) ${closed ? 'closed' : 'still missing'}`)
  }
  console.log('')

  // ---- verdict, by the same standard e2e-switch.mjs reports ---------------
  const { faults } = await inspect(root)
  const { checklist, met, missing, chars, nodes } = await scoreCoverage()

  console.log(`total:        ${stamp(runStarted)}`)
  console.log(
    `verdict:      ${faults.length === 0 ? 'renders clean' : `DOES NOT RENDER / faults — ${faults.slice(0, 4).join('; ')}${faults.length > 4 ? ` (+${faults.length - 4})` : ''}`}`,
  )
  console.log(`requirements: ${met.length}/${checklist.length} built`)
  console.log(`size:         ${chars} characters, ${nodes} nodes`)
  if (missing.length > 0) console.log(`missing:      ${missing.map((m) => m.id).join(', ')}`)
  console.log(`\nread it:      ${join(root, PAGE)}`)
}

await main()
