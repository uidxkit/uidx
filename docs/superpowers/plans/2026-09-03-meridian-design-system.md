# Meridian Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `design-systems/meridian` — 12 component pages and 4 screens for a multi-domain C4I product whose globe moves between four named stations, with the choreography enforced by build-time gates rather than by discipline.

**Architecture:** A uidx design system in the shape Vantage established: a hand-authored `tokens.uidx`, every other page generated from a descriptor in `build/components/<id>.mjs` by `build/run.mjs`, numbers written once in `build/lib/geometry.mjs` and `build/lib/stations.mjs`, contrast computed from the tokens page across all three modes, and component heights measured from the rendered PNG's own header. Two gates new to this system — `clearOfGlobe()` and `onFreeSide()` — make "a panel declares its station, not its position" a checked contract.

**Tech Stack:** Node 22 ESM, the uidx CLI (`packages/cli/dist/uidx.js`), `node:test` for unit tests. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-03-meridian-design-system-design.md` — read it before Task 1 and keep it open; every task below argues from a numbered section of it.

## Global Constraints

- **Node 22 is required.** Every command in this plan runs after `export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH`. The repo's default Node 18 fails tests with `ERR_REQUIRE_ESM`.
- **Work happens on `main`.** No worktree, no feature branch. Commit after every task.
- **Canvas:** 1600 × 1000. Rail 72 wide. Top HUD strip 64 tall. Content region x 72–1600, y 64–1000.
- **Three colour modes**, named exactly `etched`, `limb`, `living`. `etched` is the default.
- **Bind, never type.** Every fill, size, gap, radius, font size and stroke weight is a token alias reached through a handle in `build/lib/n.mjs`. Raw numbers appear only in `characters`, vector path data, and `x`/`y`.
- **`fontWeight` only ever 400–800.** 100/200/300/900 paint no glyphs at all and still audit clean.
- **Never put a token alias in `characters`.** `characters="{radius#pill}"` writes the number where the string belongs and stops the page rendering. Type it: `"999 (radius#pill)"`.
- **`status` is reserved** for a component's lifecycle and cannot be an axis name. Meridian's axes are `station`, `domain`, `severity`, `selection`, `scale`, `align`, `tone`, `size`, `attach`, `kind`, `state`, `trend`, `variant`, `count`, `density`.
- **Frame fill alpha is not honoured.** Every translucent value is a pre-blended literal, per mode.
- **`uidx render` defaults to `--scale 0.5`.** Every measurement is half unless `--scale 1` is passed.
- **A Vector's subpaths must be all closed or all open.** Mixing them in one path silently drops the unclosed subpath. Land rings are closed; graticule lines are open; they never share a Vector.
- **A Vector's path data does not scale to its declared box.** Scale the numbers, not the box.
- **`dashPattern` renders on a `Vector` and is ignored on a `Rectangle`.**

---

## File Structure

```
design-systems/meridian/
  uidx.json                 root manifest
  tokens.uidx               hand-authored; the contract lives in its ## Design section
  README.md                 renderer facts, pages, how to build something new
  backlog.md                M1..M4 from spec §11, plus what each review pass finds
  build/
    run.mjs                 build one page from its descriptor
    check.mjs               dry-run every descriptor, no CLI
    measure.mjs             render one instance of each component, read the PNG header
    all.mjs                 rebuild everything in dependency order
    lib/
      n.mjs                 token handles + node builders
      geometry.mjs          G (numbers), L (aliases), H (measured heights), fits()
      stations.mjs          the station table + clearOfGlobe() + onFreeSide()
      sphere.mjs            TopoJSON decode, orthographic projection, dot field
      contrast.mjs          computed a11y rows across three modes
      doc-page.mjs          descriptor -> architecture + batches + intent
      hierarchy.mjs         the instance graph, read from descriptors and built pages
      icons.mjs             the glyph set
    components/<id>.mjs     one descriptor per page
    screens/<id>.mjs        one descriptor per screen
    test/*.test.mjs         node:test units
```

**Responsibilities.** `stations.mjs` is the only file that knows where the globe is at each station; `geometry.mjs` is the only file that knows how tall a component draws; `n.mjs` is the only file that names a token. A descriptor knows what its own component looks like and nothing else. A screen descriptor knows only instances and the station gates.

---

### Task 1: Root, tokens and a page that audits

**Files:**
- Create: `design-systems/meridian/uidx.json`
- Create: `design-systems/meridian/tokens.uidx`
- Create: `design-systems/meridian/backlog.md`
- Create: `design-systems/meridian/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: every token name every later task binds. Collections: `space`, `radius`, `type`, `size`, `stroke`, `palette` (primitive); `color` (semantic, 3 modes), `layout`, `station` (semantic); `panel`, `chip`, `button`, `row`, `marker`, `globe`, `feed`, `timeline`, `rail`, `readout` (component).

- [ ] **Step 1: Copy the root manifest shape from Vantage**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
mkdir -p design-systems/meridian/build/lib design-systems/meridian/build/components design-systems/meridian/build/screens design-systems/meridian/build/test
cat design-systems/vantage/uidx.json
```

Write `design-systems/meridian/uidx.json` with the same keys, the name `meridian`, and the same ignore entry for the `measure-probe-*` family.

- [ ] **Step 2: Write `tokens.uidx`**

Root element is `<Tokens>` and nothing else — the format permits exactly one root and a `<Tokens>` file cannot also hold a `<Page>`, so there is **no canvas** and no swatch board (spec §6.1; backlog M3).

Primitive collections, verbatim from spec §4.3:

```
space   2 4 8 12 16 24 32 48 64          -> hair xs sm md lg xl xxl xxxl huge
radius  none 0 · sm 3 · md 6 · lg 10 · pill 999
stroke  hair 1 · mark 1.5 · ring 2 · arc 3 · limb 4
type    micro 9 · caption 11 · body 13 · label 15 · title 18 · head 24 · hero 40 · mega 64
size    rail 72 · hud 64 · icon 20 · icon-lg 28 · marker 24 · marker-lg 32 ·
        chip 22 · row 44 · row-dense 32 · lane 56 · feed-h 320 · tick 6
```

`palette` holds the three ground ramps of spec §4.1 as `etched-0..9` + `etched-label`, `limb-0..9` + `limb-label`, `living-0..9` + `living-label`; the three signals `ice #9FE8FF`, `solar #FFB35C`, `flare #FF3D81`; the shared status set `critical #FF4D6A`, `warn #FFB020`, `watch #4DA6FF`, `nominal #3DDC91`; and `white`, `ink`.

`color` is `tier="semantic"` with `modes={['etched','limb','living']}` and every name listed in spec §4.2. `limb-0`…`limb-4` all resolve to the same value in `etched` and ramp in the other two — that is what makes the terminator (spec §4).

`layout` and `station` are semantic FLOAT collections holding spec §3's numbers, one variable per number: `screen` 1600, `screen-h` 1000, `rail` 72, `hud` 64, `margin` 24, `gap` 16, `content-x` 72, `content-y` 64, `content-w` 1528, `content-h` 936, then `full-cx` 836, `full-cy` 532, `full-r` 372, `full-gutter` 344, `dock-cx` 1456, `dock-cy` 532, `dock-r` 336, `dock-col` 976, `horizon-cx` 836, `horizon-cy` 1600, `horizon-r` 900, `horizon-top` 700, `horizon-surface-h` 588, `eclipse-cx` 1520, `eclipse-cy` 32, `eclipse-r` 20.

- [ ] **Step 3: Write the `## Design` contract section**

This section is the system's contract and every later task reads it. It must state: the three laws (spec §1.2); the station table (spec §3); the HUD-versus-floating rule; **domain is glyph, status is hue** (spec §4.1) called out as the load-bearing decision; the sizing rule (hug, then fill, then grow, then fixed); what the renderer will and will not do (spec §8); and a `NEVER` list — never a gradient, never an alias in `characters`, never a `fontWeight` outside 400–800, never a domain hue, never a floating panel outside its station's free region.

Also write a `## Tokens` section documenting each collection in prose, since there is no canvas to show them on.

- [ ] **Step 4: Audit**

```bash
node packages/cli/dist/uidx.js audit design-systems/meridian
```

Expected: exit 0, no faults.

- [ ] **Step 5: Write `backlog.md` with M1–M4 from spec §11, and a README skeleton with an empty "Renderer facts" table (Task 3 fills it)**

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the tokens, and the contract they carry"
```

---

### Task 2: `n.mjs` and the test that pins it to the tokens page

**Files:**
- Create: `design-systems/meridian/build/lib/n.mjs`
- Create: `design-systems/meridian/build/test/n.test.mjs`

**Interfaces:**
- Consumes: `tokens.uidx` from Task 1.
- Produces: `T`, `S`, `R`, `TY`, `Z`, `ST`, `P`, `C`, and the component-tier handles `PN` (panel), `CP` (chip), `BTN` (button), `RW` (row), `MK` (marker), `GL` (globe), `FD` (feed), `TM` (timeline), `RL` (rail), `RO` (readout). Node builders `solid`, `NONE`, `node`, `frame`, `col`, `row`, `canvas`, `text`, `caption`, `caps`, `figure`, `para`, `fillRow`, `fillCol`, `rule`, `grow`, `rect`, `ellipse`, `vector`, `stroked`, `dashed`, `instance`, `slot`, `fill`, `hairline`, `dot`, `arcPath`, `ringPath`, `tickPath`, `dashRingPath`.

- [ ] **Step 1: Copy Vantage's `n.mjs` and re-point the handles**

```bash
cp design-systems/vantage/build/lib/n.mjs design-systems/meridian/build/lib/n.mjs
```

Then replace every handle list with Meridian's token names from Task 1. The node builders below the `---- nodes ----` line are unchanged and are the reason this is a copy rather than a rewrite — they encode measured renderer facts (dash on Vector only, weights 400–800, `canvas()` as the one layout leaf).

`caps()` keeps `letterSpacing: 1`, `textCase: 'UPPER'`, `fontWeight: 500`, but `fontSize: TY.micro` is now 9.

- [ ] **Step 2: Write the failing test**

```js
// design-systems/meridian/build/test/n.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as n from '../lib/n.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = readFileSync(resolve(here, '../../tokens.uidx'), 'utf8')

/** Every `{collection#name}` a handle can produce. */
const aliases = []
for (const [key, value] of Object.entries(n)) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const v of Object.values(value)) if (typeof v === 'string' && v.startsWith('{')) aliases.push([key, v])
  }
}

test('every handle names a variable the tokens page declares', () => {
  assert.ok(aliases.length > 60, `expected the handle set to be populated, got ${aliases.length}`)
  const missing = aliases.filter(([, alias]) => {
    const [, collection, name] = alias.match(/^\{([a-z-]+)#(.+)\}$/)
    return !new RegExp(`<Collection name="${collection}"[\\s\\S]*?<Variable name="${name}"`).test(tokens)
      && !new RegExp(`<Variable name="${name}"`).test(tokens)
  })
  assert.deepEqual(missing, [], `handles naming variables tokens.uidx does not declare: ${missing.map(([k, a]) => `${k} ${a}`).join(', ')}`)
})
```

- [ ] **Step 3: Run it and watch it fail**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node --test design-systems/meridian/build/test/n.test.mjs
```

Expected: FAIL, listing every handle whose variable is missing from `tokens.uidx`.

- [ ] **Step 4: Fix the mismatches**

Every failure is one of two bugs and both are worth fixing rather than papering over: a handle names a token that was never declared (add it to `tokens.uidx`), or `tokens.uidx` declares a token nothing can reach (delete it, or add the handle). Do not weaken the test.

- [ ] **Step 5: Run again**

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the handles, asserted against the tokens page"
```

---

### Task 3: Renderer probes, and the README facts table (evidence E2)

**Files:**
- Modify: `design-systems/meridian/README.md`
- Create (throwaway): `design-systems/meridian/probe.uidx`

**Interfaces:**
- Consumes: `n.mjs`.
- Produces: the "Renderer facts" table every later task trusts. If a probe disagrees with the Global Constraints above, **the probe wins** and this plan's constraint is corrected in the README with the measurement beside it.

- [ ] **Step 1: Build a probe page carrying one node per fact**

Probe, at `--scale 1` each time: `letterSpacing` (a tracked string measures wider than the same string plain); `textCase="UPPER"`; `dashPattern` on a `Rectangle` versus on a `Vector`; `fontWeight` 400/500/600/700/800 each render and 300/900 produce a ~135-byte empty PNG; `layoutWrap="WRAP"`; a `strokeWeight` bound to a token renders at the bound value (A/B against the literal and check the two PNGs are byte-identical); a Vector mixing a closed and an open subpath drops the open one; and the two font families the type voice needs (spec §4.3) — one monospace, one grotesque.

```bash
node packages/cli/dist/uidx.js render design-systems/meridian probe.uidx -o /tmp/probe.png --scale 1
```

- [ ] **Step 2: Write the table into README "Renderer facts (probed 2026-09-03)"**

One row per probe: the question, the answer, and the evidence as a number. A row without a number is not evidence.

- [ ] **Step 3: If a font family is unavailable, record what is available and pick from that**

The type voice is "monospace for data, grotesque for chrome". If only one family exists, say so in the README and express the voice through size, weight and tracking instead — and note it in `backlog.md`. Do not silently bind a family that does not render.

- [ ] **Step 4: Delete the probe page and commit**

```bash
rm design-systems/meridian/probe.uidx
git add design-systems/meridian && git commit -m "Meridian: the renderer's facts, measured in this root"
```

---

### Task 4: `stations.mjs` — the choreography, as two gates

This is the task that makes the concept enforceable. It is pure arithmetic with no CLI, so it is fully TDD.

**Files:**
- Create: `design-systems/meridian/build/lib/stations.mjs`
- Create: `design-systems/meridian/build/test/stations.test.mjs`

**Interfaces:**
- Consumes: nothing (numbers come from spec §3; Task 5's test asserts them against `tokens.uidx`).
- Produces:
  - `STATION` — `{ full, dock, horizon, eclipse }`, each `{ globe: {cx, cy, r}, free: Record<attach, {x, y, w, h}> }`
  - `clearOfGlobe(name, box, station) -> number` — clearance in px, throws if the box intersects the sphere
  - `onFreeSide(name, box, station, attach) -> {x,y,w,h}` — the region, throws if the box escapes it
  - `domeApex(station) -> number` and `domeExit(station) -> [number, number]`

- [ ] **Step 1: Write the failing test**

```js
// design-systems/meridian/build/test/stations.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { STATION, clearOfGlobe, onFreeSide, domeApex, domeExit } from '../lib/stations.mjs'

test('every station names a globe and at least one free region', () => {
  for (const [id, s] of Object.entries(STATION)) {
    assert.ok(s.globe.r > 0, `${id} has no radius`)
    assert.ok(Object.keys(s.free).length > 0, `${id} has no free region`)
  }
})

test('the horizon dome tops out at 700 and leaves the screen inside the content region', () => {
  assert.equal(domeApex('horizon'), 700)
  const [left, right] = domeExit('horizon')
  assert.equal(Math.round(left), 165)
  assert.equal(Math.round(right), 1507)
  assert.ok(left > 72 && right < 1600, 'the arc must exit the bottom edge inside the content region, or it reads as a circle')
})

test('clearOfGlobe passes a panel in its own free region', () => {
  assert.ok(clearOfGlobe('dossier', onFreeSide('dossier', { x: 96, y: 88, w: 976, h: 400 }, 'dock', 'left'), 'dock') > 0)
})

test('clearOfGlobe refuses a panel that overlaps the sphere', () => {
  assert.throws(
    () => clearOfGlobe('greedy', { x: 96, y: 88, w: 1300, h: 400 }, 'dock'),
    /greedy.*overlaps the globe at dock/s,
  )
})

test('onFreeSide refuses an attach the station does not offer', () => {
  assert.throws(() => onFreeSide('p', { x: 96, y: 88, w: 100, h: 100 }, 'dock', 'right'), /dock offers: left/)
})

test('onFreeSide refuses a box that escapes its region', () => {
  assert.throws(
    () => onFreeSide('p', { x: 96, y: 88, w: 400, h: 100 }, 'full', 'left'),
    /escapes the left region of full/,
  )
})

test('a full-station panel fits the left gutter exactly', () => {
  assert.doesNotThrow(() => onFreeSide('p', { x: 96, y: 88, w: 344, h: 888 }, 'full', 'left'))
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node --test design-systems/meridian/build/test/stations.test.mjs
```

Expected: FAIL — `Cannot find module '../lib/stations.mjs'`.

- [ ] **Step 3: Write the implementation**

```js
// design-systems/meridian/build/lib/stations.mjs
//
// Where the globe is at each station, and where a panel is allowed to be.
//
// Meridian's one idea is that a panel declares its *station* rather than its
// position, and that opening a panel is what moves the globe. That is only a
// system if something refuses the alternative, so the two gates below are the
// idea in executable form: `clearOfGlobe` refuses a panel drawn over the
// sphere, `onFreeSide` refuses one placed anywhere but the region its station
// offers. Both throw in the terms the author was thinking in.
//
// Every number here is spec §3 and is asserted against `tokens.uidx` by
// test/geometry.test.mjs, so the table and the token collection cannot drift.

export const SCREEN = { w: 1600, h: 1000, rail: 72, hud: 64, margin: 24, gap: 16 }
/** The region the stations live in: right of the rail, below the HUD strip. */
export const CONTENT = { x: 72, y: 64, w: 1528, h: 936 }
/** The same, inset by the margin — every free region is a subset of this. */
const INSET = { x: 96, y: 88, w: 1480, h: 888 }

export const STATION = {
  full: {
    globe: { cx: 836, cy: 532, r: 372 },
    free: {
      left: { x: 96, y: 88, w: 344, h: 888 },
      right: { x: 1232, y: 88, w: 344, h: 888 },
    },
  },
  dock: {
    globe: { cx: 1456, cy: 532, r: 336 },
    free: { left: { x: 96, y: 88, w: 976, h: 888 } },
  },
  horizon: {
    globe: { cx: 836, cy: 1600, r: 900 },
    free: { top: { x: 96, y: 88, w: 1480, h: 588 } },
  },
  eclipse: {
    globe: { cx: 1520, cy: 32, r: 20 },
    free: { wide: { ...INSET } },
  },
}

const station = (id) => {
  const s = STATION[id]
  if (!s) throw new Error(`no station named "${id}" — the four are ${Object.keys(STATION).join(', ')}`)
  return s
}

/** The y the dome's apex reaches. Only meaningful where the centre is off-screen. */
export const domeApex = (id) => {
  const { cy, r } = station(id).globe
  return cy - r
}

/** The two x where the dome's arc crosses the bottom edge of the screen. */
export function domeExit(id) {
  const { cx, cy, r } = station(id).globe
  const dy = cy - SCREEN.h
  if (Math.abs(dy) >= r) throw new Error(`the ${id} globe does not cross the bottom edge`)
  const dx = Math.sqrt(r * r - dy * dy)
  return [cx - dx, cx + dx]
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

/**
 * Clearance between a box and the station's sphere, in px. Throws when they
 * overlap — a floating panel drawn over the globe breaks law 2 (HUD is what
 * sits on the sphere; a filled panel never does).
 */
export function clearOfGlobe(name, box, id) {
  const { cx, cy, r } = station(id).globe
  const nx = clamp(cx, box.x, box.x + box.w)
  const ny = clamp(cy, box.y, box.y + box.h)
  const d = Math.hypot(cx - nx, cy - ny)
  if (d < r) {
    throw new Error(
      `${name} overlaps the globe at ${id} by ${Math.ceil(r - d)}px. ` +
        `A floating panel never sits on the sphere — only HUD does. ` +
        `Shrink it, move it into the free region, or put its content on a different station.`,
    )
  }
  return d - r
}

/**
 * The free region a panel binds to, or a refusal. `attach` is not decoration:
 * it is the panel naming which region of its station it lives in, and the
 * values are exactly the keys each station offers.
 */
export function onFreeSide(name, box, id, attach) {
  const { free } = station(id)
  const region = free[attach]
  if (!region) {
    throw new Error(
      `${name} attaches "${attach}", which ${id} does not offer: ${Object.keys(free).join(', ')}.`,
    )
  }
  const over = [
    box.x < region.x && `${region.x - box.x} past its left edge`,
    box.y < region.y && `${region.y - box.y} above its top edge`,
    box.x + box.w > region.x + region.w && `${box.x + box.w - region.x - region.w} past its right edge`,
    box.y + box.h > region.y + region.h && `${box.y + box.h - region.y - region.h} below its bottom edge`,
  ].filter(Boolean)
  if (over.length) {
    throw new Error(
      `${name} escapes the ${attach} region of ${id} — ${over.join(', ')}. ` +
        `The region is ${region.w} × ${region.h} at ${region.x},${region.y}.`,
    )
  }
  return region
}
```

- [ ] **Step 4: Run the tests**

Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the stations, and the two gates that make them a contract"
```

---

### Task 5: `geometry.mjs` and its test

**Files:**
- Create: `design-systems/meridian/build/lib/geometry.mjs`
- Create: `design-systems/meridian/build/test/geometry.test.mjs`

**Interfaces:**
- Consumes: `stations.mjs`, `tokens.uidx`.
- Produces: `G` (numbers), `L` (the same values as aliases), `H` (measured heights, one marked line per component, all starting `null`), `stack(items, gap)`, `PANEL_CHROME`, `panelHeight(body)`, `fits(panel, holds, gap, body)`.

- [ ] **Step 1: Copy Vantage's `geometry.mjs`, then replace `G`, `L` and `H`**

```bash
cp design-systems/vantage/build/lib/geometry.mjs design-systems/meridian/build/lib/geometry.mjs
```

`G` mirrors the `layout` and `station` collections exactly. `H` gets **one line per component, each starting at `null` and carrying its own marker**, so that a later parallel build can edit only its own line:

```js
export const H = {
  rule: 1,
  chip: null,          // H:chip
  button: null,        // H:button
  readout: null,       // H:readout
  marker: null,        // H:marker
  rail: null,          // H:rail
  segmented: null,     // H:segmented
  panel: null,         // H:panel
  row: null,           // H:row
  globe: null,         // H:globe
  feed: null,          // H:feed
  timeline: null,      // H:timeline
}
```

`PANEL_CHROME` is `G.panelPad * 2 + G.panelHeader + G.panelGap` and is stated as arithmetic in a comment, with every term a fixed token so it is not a font metric.

- [ ] **Step 2: Write the failing test**

```js
// design-systems/meridian/build/test/geometry.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { G, L, H, stack, fits, PANEL_CHROME } from '../lib/geometry.mjs'
import { STATION, CONTENT, SCREEN } from '../lib/stations.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const tokens = readFileSync(resolve(here, '../../tokens.uidx'), 'utf8')
const declared = (name) => {
  const m = tokens.match(new RegExp(`<Variable name="${name}" type="FLOAT" value=\\{(-?[0-9.]+)\\}`))
  return m ? Number(m[1]) : null
}

test('every number in G is the number tokens.uidx declares', () => {
  const wrong = Object.entries(L)
    .map(([key, alias]) => {
      const name = alias.match(/#(.+)\}$/)[1]
      const want = declared(name)
      return want !== null && want !== G[key] ? `${key}: G says ${G[key]}, tokens say ${want}` : null
    })
    .filter(Boolean)
  assert.deepEqual(wrong, [], wrong.join(' | '))
})

test('the station table agrees with the tokens page', () => {
  assert.equal(STATION.full.globe.r, declared('full-r'))
  assert.equal(STATION.dock.globe.cx, declared('dock-cx'))
  assert.equal(STATION.horizon.globe.r, declared('horizon-r'))
  assert.equal(STATION.eclipse.globe.r, declared('eclipse-r'))
})

test('the content region is the screen minus the rail and the HUD strip', () => {
  assert.equal(CONTENT.x, SCREEN.rail)
  assert.equal(CONTENT.y, SCREEN.hud)
  assert.equal(CONTENT.w, SCREEN.w - SCREEN.rail)
  assert.equal(CONTENT.h, SCREEN.h - SCREEN.hud)
})

test('fits refuses an unmeasured height rather than counting it as zero', () => {
  assert.throws(() => fits('panel', [44, null], 8, 200), /not measured yet/)
})

test('fits refuses content taller than its box, and says by how much', () => {
  assert.throws(() => fits('panel', [100, 100, 100], 8, 200), /116 too much/)
})

test('stack adds the gaps between items and not after the last', () => {
  assert.equal(stack([10, 10, 10], 5), 40)
})
```

- [ ] **Step 3: Run, watch it fail, fix the numbers until it passes**

```bash
node --test design-systems/meridian/build/test/
```

- [ ] **Step 4: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the grid, in one place, asserted against the tokens"
```

---

### Task 6: `contrast.mjs` across three modes

**Files:**
- Create: `design-systems/meridian/build/lib/contrast.mjs`
- Create: `design-systems/meridian/build/test/contrast.test.mjs`

**Interfaces:**
- Consumes: `tokens.uidx`.
- Produces: `row(label, fgAlias, bgAlias, kind) -> [string, string]` where `kind` is `'text'` (floor 4.5), `'large'` (3), `'ui'` (3) or `'none'`. The returned string states the ratio in **all three modes** and says `FAILS` with the number when one is short.

- [ ] **Step 1: Copy Vantage's `contrast.mjs` and widen it from two modes to three**

```bash
cp design-systems/vantage/build/lib/contrast.mjs design-systems/meridian/build/lib/contrast.mjs
```

The mode list becomes `['etched', 'limb', 'living']` and the output format becomes `"12.77:1 etched / 13.88:1 limb / 9.40:1 living — passes AAA"`. A pair that fails in any mode prints `FAILS` and names which mode.

- [ ] **Step 2: Write the failing test**

```js
// design-systems/meridian/build/test/contrast.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { row } from '../lib/contrast.mjs'

test('a row states a ratio for each of the three modes', () => {
  const [, verdict] = row('text on panel', '{color#text}', '{color#panel}', 'text')
  assert.match(verdict, /etched/)
  assert.match(verdict, /limb/)
  assert.match(verdict, /living/)
})

test('body text on the panel clears 4.5:1 in every mode', () => {
  const [, verdict] = row('text on panel', '{color#text}', '{color#panel}', 'text')
  assert.doesNotMatch(verdict, /FAILS/, `the system's most common text pair must pass: ${verdict}`)
})

test('a failing pair says FAILS and names the mode', () => {
  const [, verdict] = row('label on panel', '{color#label}', '{color#panel}', 'text')
  if (/FAILS/.test(verdict)) assert.match(verdict, /etched|limb|living/)
})

test('an unresolvable alias throws rather than silently scoring zero', () => {
  assert.throws(() => row('nope', '{color#does-not-exist}', '{color#panel}', 'text'), /does-not-exist/)
})
```

- [ ] **Step 3: Run, fix, run again**

The second test is the one that may genuinely fail, and if it does the fix is **in `tokens.uidx`, not in the test**: move the token until the pair clears 4.5:1 in all three modes, then re-run Task 2 and Task 5's tests.

- [ ] **Step 4: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: contrast computed across three modes, never typed"
```

---

### Task 7: `sphere.mjs` — real coastlines, orthographically

**Files:**
- Create: `design-systems/meridian/build/lib/sphere.mjs`
- Create: `design-systems/meridian/build/data/land-50m.json` (copied, not fetched)
- Create: `design-systems/meridian/build/test/sphere.test.mjs`

**Interfaces:**
- Consumes: nothing at build time (the data file is checked in).
- Produces:
  - `project(lon, lat, {cx, cy, r, rotation}) -> {x, y, z}` — orthographic; `z > 0` is the visible hemisphere
  - `dotField({cx, cy, r, rotation, budget}) -> Array<{x, y}>` — land dots only, never more than `budget`
  - `graticulePaths({cx, cy, r, rotation}) -> string` — meridians and parallels, **all subpaths open**
  - `landRingPaths({cx, cy, r, rotation}) -> string` — coastline rings, **all subpaths closed**
  - `limbBands({cx, cy, r, terminator}) -> Array<{d: string, band: 0|1|2|3|4}>` — the terminator, as a ladder of closed bands

- [ ] **Step 1: Copy the data and the decoder**

```bash
mkdir -p design-systems/meridian/build/data
cp design-systems/vantage/build/data/land-50m.json design-systems/meridian/build/data/
```

Port `loadTopology()`, `decodeArc()` and `landRings()` from `design-systems/vantage/build/lib/coast.mjs` verbatim — they are forty lines of TopoJSON decoding with no dependency. Drop `landPaths()` and `graticule()`: those project equirectangularly and Meridian needs orthographic.

- [ ] **Step 2: Write the failing test**

```js
// design-systems/meridian/build/test/sphere.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { project, dotField, graticulePaths, landRingPaths } from '../lib/sphere.mjs'

const G = { cx: 836, cy: 532, r: 372, rotation: 0 }

test('the sub-observer point lands at the centre and faces us', () => {
  const p = project(0, 0, G)
  assert.equal(Math.round(p.x), G.cx)
  assert.equal(Math.round(p.y), G.cy)
  assert.ok(p.z > 0)
})

test('the far side has negative z', () => {
  assert.ok(project(180, 0, G).z < 0)
})

test('the north pole is r above the centre', () => {
  const p = project(0, 90, G)
  assert.equal(Math.round(p.y), G.cy - G.r)
})

test('no projected point escapes the sphere', () => {
  for (let lon = -180; lon <= 180; lon += 7) {
    for (let lat = -90; lat <= 90; lat += 7) {
      const p = project(lon, lat, G)
      assert.ok(Math.hypot(p.x - G.cx, p.y - G.cy) <= G.r + 0.001, `${lon},${lat} escaped`)
    }
  }
})

test('the dot field respects its budget and only draws the visible hemisphere', () => {
  const dots = dotField({ ...G, budget: 450 })
  assert.ok(dots.length > 100, `too few dots to read as Earth: ${dots.length}`)
  assert.ok(dots.length <= 450, `over budget: ${dots.length}`)
  for (const d of dots) assert.ok(Math.hypot(d.x - G.cx, d.y - G.cy) <= G.r)
})

test('the dot field puts dots on land and not in the middle of the Pacific', () => {
  // Rotated so the Pacific faces us; a land-masked field is much sparser there.
  const pacific = dotField({ ...G, rotation: -160, budget: 450 }).length
  const africa = dotField({ ...G, rotation: -20, budget: 450 }).length
  assert.ok(africa > pacific * 1.3, `land mask is not working: africa ${africa}, pacific ${pacific}`)
})

test('graticule subpaths are all open and land rings are all closed', () => {
  assert.doesNotMatch(graticulePaths(G), /Z/, 'a graticule line must not close')
  const land = landRingPaths(G)
  const subpaths = land.split('M').filter(Boolean)
  for (const s of subpaths) assert.match(s, /Z\s*$/, 'every land ring must close, or the renderer drops it')
})
```

- [ ] **Step 3: Run, watch it fail, implement**

```js
// design-systems/meridian/build/lib/sphere.mjs — the projection, in the sketch it needs
const RAD = Math.PI / 180

export function project(lon, lat, { cx, cy, r, rotation = 0 }) {
  const la = lat * RAD
  const lo = (lon + rotation) * RAD
  return {
    x: cx + r * Math.cos(la) * Math.sin(lo),
    y: cy - r * Math.sin(la),
    z: Math.cos(la) * Math.cos(lo),
  }
}
```

`dotField` walks a lat/lon lattice (about 26 parallels, each with a dot count proportional to `cos(lat)` so the spacing is even rather than crowding the poles), keeps a point only where `z > 0` **and** a point-in-ring test against `landRings()` says it is on land, then decimates evenly to `budget` if it is over. Decimate by stride (`Math.ceil(len / budget)`), never by `slice`, which would drop a whole hemisphere.

- [ ] **Step 4: Run the tests**

Expected: PASS, 7/7. The Pacific-versus-Africa test is the one that proves the land mask is real rather than decorative.

- [ ] **Step 5: Render one sphere by eye before trusting it**

Build a throwaway page with a single 744px sphere and open the PNG. A dot field that passes every test can still read as noise. If it does, adjust the parallel count and the dot size — not the tests — and record the number you settled on in the README.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the sphere, with real coastlines and a budget"
```

---

### Task 8: The page pipeline — `doc-page.mjs`, `hierarchy.mjs`, `icons.mjs`, `run.mjs`, `check.mjs`, `measure.mjs`, `all.mjs`

**Files:**
- Create: `design-systems/meridian/build/lib/doc-page.mjs`, `hierarchy.mjs`, `icons.mjs`
- Create: `design-systems/meridian/build/run.mjs`, `check.mjs`, `measure.mjs`, `all.mjs`
- Create: `design-systems/meridian/build/components/_TEMPLATE.mjs`
- Create: `design-systems/meridian/build/test/doc-page.test.mjs`

**Interfaces:**
- Consumes: `n.mjs`, `geometry.mjs`, `contrast.mjs`, `hierarchy.mjs`.
- Produces: `docPage(descriptor, graph) -> { architecture, batches, intent }`; `allCharacters(nodes) -> string[]`; the CLI wrappers; and `_TEMPLATE.mjs`, the twelve-section descriptor skeleton every component task copies.

- [ ] **Step 1: Copy the four library files and the four scripts from Vantage**

```bash
cd design-systems
cp vantage/build/lib/doc-page.mjs vantage/build/lib/hierarchy.mjs vantage/build/lib/icons.mjs meridian/build/lib/
cp vantage/build/run.mjs vantage/build/check.mjs vantage/build/measure.mjs vantage/build/all.mjs meridian/build/
cd ..
```

Then edit each for Meridian: the `ROOT` comments and paths, `icons.mjs` gets Meridian's glyph set (the five domain glyphs of spec §6.3 plus the rail's eight icons), and `all.mjs` gets Meridian's `ORDER` — the waves of spec §6.13, leaves first, and a comment saying **why** it is an explicit order and not a glob (the apply gate checks each op against the document as it stands, so a page whose component instances another must be built after it).

- [ ] **Step 2: Extend `check.mjs` with the screen gate**

`check.mjs` already refuses a token alias in `characters` and a `fontWeight` outside 400–800. Meridian adds the third refusal from spec §2.1 — a screen descriptor that draws instead of instancing:

```js
/** Elements a screen may not create directly. A screen composes instances. */
const PRIMITIVES = new Set(['Rectangle', 'Ellipse', 'Vector', 'Text'])

function drawnByScreen(nodes) {
  const out = []
  const walk = (n, insideInstance) => {
    if (!n || typeof n !== 'object') return
    if (!insideInstance && PRIMITIVES.has(n.element)) out.push(`${n.element} "${n.name ?? '(unnamed)'}"`)
    ;(n.children ?? []).forEach((c) => walk(c, insideInstance || n.element === 'Instance'))
  }
  nodes.forEach((n) => walk(n, false))
  return out
}
```

Run it only over `build/screens/`, and fail with: `"<screen> draws <n> primitives itself. A screen composes instances only — promote the shape to a component, or change the screen."`

- [ ] **Step 3: Write `_TEMPLATE.mjs`**

A complete, buildable descriptor with all twelve sections present and commented, modelled on `design-systems/vantage/build/components/status-pill.mjs`. Sections in order: `id`, `title`, `eyebrow`, `tier`, `tokenCollections`, `definition`, `overview`, `notFor`, `howToUse`, `component` (`name`, `props`, `axes`, `variant`), `states`, `anatomy`, `anatomyProps`, `properties`, `measurements`, `inContext`, `guidance` (`do`/`dont`), `accessibility`, `content`, `related`, `references`, `changelog`, `appearance`, `constraints`, `intent` (`core`, `structure`, `antiPatterns`, `design`).

- [ ] **Step 4: Write the pipeline test**

```js
// design-systems/meridian/build/test/doc-page.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { docPage, allCharacters } from '../lib/doc-page.mjs'
import { default as template } from '../components/_TEMPLATE.mjs'

test('the template descriptor builds an architecture and at least one batch', () => {
  const p = docPage(template)
  assert.ok(p.architecture)
  assert.ok(p.batches.length >= 1)
  assert.ok(p.intent.length > 0)
})

test('no page writes a token alias into characters', () => {
  const nodes = docPage(template).batches.flat().map((o) => o.node)
  assert.deepEqual(allCharacters(nodes).filter((s) => /\{[a-z-]+#/.test(s)), [])
})
```

- [ ] **Step 5: Run the whole suite and `check.mjs`**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node --test design-systems/meridian/build/test/
node design-systems/meridian/build/check.mjs
```

Expected: tests pass; `check.mjs` reports `ok _TEMPLATE.mjs`.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the page pipeline, and the gate that keeps screens honest"
```

---

## Wave 1 — the leaves (Tasks 9–11)

Every task in Wave 1 has the same five steps and differs only in its descriptor. The steps are written out in Task 9 and repeated in each; nothing is left as "as in Task 9".

### Task 9: `chip`, `button`, `readout`

**Files:**
- Create: `design-systems/meridian/build/components/chip.mjs`, `button.mjs`, `readout.mjs`
- Modify: `design-systems/meridian/build/lib/geometry.mjs` (the `// H:chip`, `// H:button`, `// H:readout` lines only)
- Modify: `design-systems/meridian/build/measure.mjs` (the `// SPEC:chip`, `// SPEC:button`, `// SPEC:readout` lines only)

**Interfaces:**
- Consumes: `n.mjs`, `contrast.mjs`, `_TEMPLATE.mjs`.
- Produces: components `Chip`, `Button`, `Readout`, instanced by Tasks 10–14 and by every screen.

**`Chip`** — data tier. Axes `severity` (critical · warn · watch · nominal), `variant` (solid · outline · dot). Prop `label: TEXT`. Height `size#chip` 22, `radius#pill`, `space#sm` side padding, label in `caps()`. `dot` variant is a 6px `dot()` plus a caps label and no capsule. Twelve designed cells, no "not designed".

**`Button`** — controls tier. Axes `kind` (primary · ghost · icon), `state` (rest · hover · active · disabled). Prop `label: TEXT`. `primary` fills with `color#signal` and takes `color#text-inverse`; `ghost` is a 1px `color#hairline-strong` inside stroke and `color#text`; `icon` is a square `size#icon-lg` with a glyph from `icons.mjs`. `radius#md`.

**`Readout`** — data tier, and the concrete form of law 2: **no fill, no stroke, no radius, ever.** Axes `scale` (micro · normal · hero), `align` (start · end), `tone` (plain · signal · severity). Props `label`, `value`, `unit`. A `col()` of a `caps()` label over a value at `type#caption` / `type#head` / `type#hero` by scale.

- [ ] **Step 1: Write the three descriptors**

```bash
cd design-systems/meridian/build/components
for c in chip button readout; do cp _TEMPLATE.mjs $c.mjs; done
```

Fill every one of the twelve sections. `accessibility` rows come from `contrast.mjs`'s `row()` — computed, never typed. `measurements` states each value with its token in brackets, e.g. `['height', '22 (size#chip)']`.

- [ ] **Step 2: Dry-run all three before touching the CLI**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

Expected: `ok chip.mjs`, `ok button.mjs`, `ok readout.mjs`. A `FAIL` here is an alias in `characters` or an undrawable weight; fix the descriptor, not the check.

- [ ] **Step 3: Build and render each**

```bash
node design-systems/meridian/build/run.mjs chip
node design-systems/meridian/build/run.mjs button
node design-systems/meridian/build/run.mjs readout
```

Expected: each ends `rendered .../chip.png` with a clean audit.

- [ ] **Step 4: Open the renders and look at them**

```bash
open design-systems/meridian/.build/chip/chip.png design-systems/meridian/.build/button/button.png design-systems/meridian/.build/readout/readout.png
```

The audits cannot see a widow, a collision or ugly. A render you have not opened is not evidence.

- [ ] **Step 5: Measure, and record the drawn height**

Uncomment the `// SPEC:chip`, `// SPEC:button` and `// SPEC:readout` lines in `measure.mjs`, then:

```bash
node design-systems/meridian/build/measure.mjs --check
```

Put the height it **measured** on each component's `// H:` line in `geometry.mjs` — not the height you expected. Re-run `--check` until it agrees.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: chip, button and readout — the three leaves"
```

---

### Task 10: `marker` and `segmented`

**Files:**
- Create: `design-systems/meridian/build/components/marker.mjs`, `segmented.mjs`
- Modify: `geometry.mjs` (`// H:marker`, `// H:segmented` only), `measure.mjs` (`// SPEC:marker`, `// SPEC:segmented` only)

**Interfaces:**
- Consumes: `n.mjs`, `icons.mjs`, `contrast.mjs`.
- Produces: `Marker` (instanced by `globe` in Task 12 and by three screens), `Segmented` (instanced by `survey` and `desk`).

**`Marker`** — Axes `domain` (land · sea · air · space · cyber), `severity` (critical · warn · watch · nominal), `selection` (none · selected). **Domain is the glyph, severity is the hue** — this is spec §4.1's load-bearing rule and this component is where it is either kept or lost. Drawn on a `canvas()` of `size#marker` 24 (`marker-lg` 32 when selected). Selected adds a dashed halo: a `Vector` with `dashPattern`, since a `Rectangle` ignores it.

**`Segmented`** — Axes `size` (sm · md), `count` (2 · 3 · 4 · 5). A `row()` of segments, the active one filled with `color#panel-raised` and labelled `color#text`, the rest `color#label`. Props `labels: TEXT` (comma-separated) and `active: TEXT`.

- [ ] **Step 1: Write both descriptors, all twelve sections, `accessibility` computed by `contrast.mjs`**

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

Expected: `ok marker.mjs`, `ok segmented.mjs`.

- [ ] **Step 3: Build both**

```bash
node design-systems/meridian/build/run.mjs marker
node design-systems/meridian/build/run.mjs segmented
```

- [ ] **Step 4: Open both renders and check the five glyphs are distinguishable at 24px in greyscale**

```bash
open design-systems/meridian/.build/marker/marker.png design-systems/meridian/.build/segmented/segmented.png
```

If two domain glyphs are confusable at 24px, redraw one. Hue may not be used to tell them apart.

- [ ] **Step 5: Measure and record**

Uncomment `// SPEC:marker` and `// SPEC:segmented`, run `node design-systems/meridian/build/measure.mjs --check`, and put the measured heights on the `// H:` lines.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the marker, where domain is glyph and severity is hue"
```

---

### Task 11: `rail`

**Files:**
- Create: `design-systems/meridian/build/components/rail.mjs`
- Modify: `geometry.mjs` (`// H:rail` only), `measure.mjs` (`// SPEC:rail` only)

**Interfaces:**
- Consumes: `n.mjs`, `icons.mjs`.
- Produces: `Rail`, instanced by all four screens — the one piece of furniture present at every station.

**`Rail`** — chrome tier. Axis `state` (rest · hover · active · alert) on its items. `layout#rail` 72 wide, full screen height, a `col()` of eight icon pills at `size#icon-lg`. The active item carries `color#signal`; an alert item carries `color#critical`. Drawn on a `canvas()` so it keeps its declared width inside a stretching parent.

- [ ] **Step 1: Write the descriptor, all twelve sections**

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

- [ ] **Step 3: Build**

```bash
node design-systems/meridian/build/run.mjs rail
```

- [ ] **Step 4: Open the render**

```bash
open design-systems/meridian/.build/rail/rail.png
```

Confirm it draws exactly 72 wide — `layout#rail`. A rail that measures 74 is a rail every screen will be one gutter out.

- [ ] **Step 5: Measure and record on the `// H:rail` line**

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the rail, at every station"
```

---

## Wave 2 — the composites (Tasks 12–14)

### Task 12: `globe` — the heart

**Files:**
- Create: `design-systems/meridian/build/components/globe.mjs`
- Modify: `geometry.mjs` (`// H:globe` only), `measure.mjs` (`// SPEC:globe` only)

**Interfaces:**
- Consumes: `sphere.mjs`, `stations.mjs`, `n.mjs`, and `Marker` from Task 10.
- Produces: `Globe`, instanced by all four screens. Props `rotation: FLOAT`, `terminator: FLOAT`, `ringMode: TEXT` (`domain` | `bearing`).

Axis: `station` (full · dock · horizon · eclipse). The four station geometries come from `STATION[station].globe` — **never typed into this descriptor**.

Parts, in paint order: limb band ladder (closed `Vector`s, `color#limb-0..4`) → dot field (`ellipse`s at `color#sphere-dot`, budget from spec §6.2: ≤450 at `full`, scaled by radius at the others) → land rings (one closed `Vector`) → graticules (one open `Vector`) → terminator → atmosphere ring → bearing ring (ticks via `tickPath`, domain arcs via `arcPath`, sun index, selected bearing) → marker layer (`Marker` instances) → track arcs.

At `eclipse` the ring **is** the component: a 40px sphere and its aggregate status arc, nothing else.

- [ ] **Step 1: Write the descriptor**

The `variant` function is `({ station }) => ...` and its first line reads the geometry rather than typing it:

```js
import { STATION } from '../lib/stations.mjs'
import { dotField, graticulePaths, landRingPaths, limbBands } from '../lib/sphere.mjs'

const globe = ({ station }) => {
  const g = STATION[station].globe
  const budget = station === 'full' ? 450 : Math.round(450 * (g.r / STATION.full.globe.r))
  // ... paint order above, all drawn on a canvas() sized to the station's box
}
```

- [ ] **Step 2: Dry-run, and check the node count before rendering**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

`check.mjs` prints each batch's JSON length. If the `full` batch is over ~400KB the dot budget is too high — lower it and re-run. An unbudgeted field is how a component becomes an unopenable page.

- [ ] **Step 3: Build**

```bash
node design-systems/meridian/build/run.mjs globe
```

- [ ] **Step 4: Render each station at full scale and open all four**

```bash
for s in full dock horizon eclipse; do
  node packages/cli/dist/uidx.js render design-systems/meridian globe.uidx -o /tmp/globe-$s.png --scale 1
done
open /tmp/globe-*.png
```

Check by eye: continents are recognisable; the `dock` sphere is genuinely cropped by the right edge rather than merely small; the `horizon` dome reads as a horizon and not as a circle; `eclipse` still reads as Earth at 40px.

- [ ] **Step 5: Render all three modes and confirm the terminator behaves**

```bash
open design-systems/meridian/.build/globe/globe.png
```

In `etched` the limb bands must be indistinguishable — a flat sphere. In `limb` and `living` they must ramp. If `etched` shows banding, its `limb-0..4` are not all the same value; fix `tokens.uidx`, not the descriptor.

- [ ] **Step 6: Measure and record on the `// H:globe` line, then commit**

```bash
node design-systems/meridian/build/measure.mjs --check
git add design-systems/meridian && git commit -m "Meridian: the globe, at four stations and in three modes"
```

---

### Task 13: `panel` and `row`

**Files:**
- Create: `design-systems/meridian/build/components/panel.mjs`, `row.mjs`
- Modify: `geometry.mjs` (`// H:panel`, `// H:row` only), `measure.mjs` (`// SPEC:panel`, `// SPEC:row` only)

**Interfaces:**
- Consumes: `Button` and `Chip` from Task 9.
- Produces: `Panel` (props `title: TEXT`, `showClose: BOOLEAN`; slot `body`), `Row` (props `label`, `value`, `meta`).

**`Panel`** — chrome tier. Axes `size` (sm · md · lg), `attach` (left · right · top · wide), `tone` (plain · alert). Header is a fixed `layout#panel-header` tall so `PANEL_CHROME` stays arithmetic and not a font metric. **`attach` is the panel naming which free region of its station it binds to** — the four values are exactly the keys `STATION[*].free` offers, and Task 15 checks every placement against them. A slot fill carries content only; the declared slot lays it out.

**`Row`** — data tier, the workhorse. Axes `kind` (track · related · crew · record · header), `state` (rest · hover · selected), `trend` (none · up · down). Heights: `size#row` 44 for track/related/crew, `size#row-dense` 32 for record/header. Instances `Chip` for severity and `Readout` for a trailing figure.

- [ ] **Step 1: Write both descriptors, all twelve sections**

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

- [ ] **Step 3: Build, in order — `panel` instances `Button` and `Chip`, so both must exist first**

```bash
node design-systems/meridian/build/run.mjs panel
node design-systems/meridian/build/run.mjs row
```

If either fails with "instances X, which no page defines", Task 9 did not finish; go back rather than reordering.

- [ ] **Step 4: Open both renders**

```bash
open design-systems/meridian/.build/panel/panel.png design-systems/meridian/.build/row/row.png
```

Check the five `row` kinds line up on a shared baseline grid — four densities that do not share a grid is how a table stops reading as a table.

- [ ] **Step 5: Measure both, record on the `// H:` lines, and verify `PANEL_CHROME` against the drawn panel**

```bash
node design-systems/meridian/build/measure.mjs --check
```

`H.panel` minus its default body must equal `PANEL_CHROME`. If it does not, the header is not the fixed height `geometry.mjs` believes; fix the descriptor.

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the panel and the row that does four jobs"
```

---

### Task 14: `feed` and `timeline`

**Files:**
- Create: `design-systems/meridian/build/components/feed.mjs`, `timeline.mjs`
- Modify: `geometry.mjs` (`// H:feed`, `// H:timeline` only), `measure.mjs` (`// SPEC:feed`, `// SPEC:timeline` only)

**Interfaces:**
- Consumes: `Readout` and `Chip` from Task 9.
- Produces: `Feed` (instanced by `inspect`), `Timeline` (instanced by `plan`).

**`Feed`** — data tier, and the component that makes spec §5.2's arrangement possible: the still that stands in for a video, floating on the left while the globe holds the area on the right. Axis `state` (live · recorded · lost). Parts: frame at `size#feed-h` 320 tall, scanline hairlines (one open `Vector`, evenly spaced), a reticle, a timecode `Readout` at `micro`, a source caption. `live` carries a `critical` dot; `lost` greys the frame and states why.

**`Timeline`** — data tier. Axis `density` (normal · dense). Parts: four lanes at `size#lane` 56, a now-line, severity windows (`Chip` colours as fills), a scrubber, and **the drop hairlines that tie a window to its marker on the dome** — spec §5.3's detail, and the reason the plan and the world read as one object. The drop lines are drawn by `timeline` but their x positions come from the screen, so they are a prop: `drops: TEXT`, a comma-separated list of x offsets.

- [ ] **Step 1: Write both descriptors, all twelve sections**

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

- [ ] **Step 3: Build both**

```bash
node design-systems/meridian/build/run.mjs feed
node design-systems/meridian/build/run.mjs timeline
```

- [ ] **Step 4: Open both renders**

```bash
open design-systems/meridian/.build/feed/feed.png design-systems/meridian/.build/timeline/timeline.png
```

The scanlines must read as a screen, not as a hatch pattern. If they read as texture, widen the spacing.

- [ ] **Step 5: Measure both and record on the `// H:` lines**

- [ ] **Step 6: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: the feed and the timeline that reaches down to the dome"
```

---

## Wave 3 — the screens (Tasks 15–18)

Every screen composes instances only. `check.mjs` refuses a screen that draws a primitive itself (Task 8, Step 2), and every floating panel is placed through the two gates.

### Task 15: `survey` — station `full`

**Files:**
- Create: `design-systems/meridian/build/screens/survey.mjs`

**Interfaces:**
- Consumes: every component from Waves 1–2; `STATION`, `clearOfGlobe`, `onFreeSide` from Task 4; `fits` from Task 5.
- Produces: the pattern the other three screens follow.

Contents, from spec §5.1: `Rail`; a bare top HUD strip of `Readout`s; `Globe` at `station="full"` with markers across all five domains; a `Panel` in the **left** gutter (operating picture — timestamp, the at-risk line, one `Row`); `Readout`s plus a priority-tracks `Panel` in the **right** gutter (three `Row`s with trend); a bottom legend of four `Chip`s in `dot` variant, bare, no box; a `Segmented` domain filter top-right.

- [ ] **Step 1: Write the screen descriptor, placing every panel through both gates**

```js
import { STATION, clearOfGlobe, onFreeSide } from '../lib/stations.mjs'
import { H, fits, PANEL_CHROME } from '../lib/geometry.mjs'

const STATION_ID = 'full'
/** Every floating panel states its box, its attach, and is refused if either is wrong. */
const place = (name, box, attach) => {
  onFreeSide(name, box, STATION_ID, attach)
  clearOfGlobe(name, box, STATION_ID)
  return box
}

const picture = place('operating-picture', { x: 96, y: 88, w: 344, h: PANEL_CHROME + 160 }, 'left')
const priority = place('priority-tracks', { x: 1232, y: 300, w: 344, h: PANEL_CHROME + 3 * H.row + 2 * 8 }, 'right')
fits('priority-tracks', [H.row, H.row, H.row], 8, 3 * H.row + 2 * 8)
```

- [ ] **Step 2: Dry-run — the gates run at import, so a bad placement fails here**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

Expected: `ok survey.mjs`. A throw naming a panel and a station is the gate doing its job; move the panel, do not weaken the gate.

- [ ] **Step 3: Build**

```bash
node design-systems/meridian/build/run.mjs survey
```

- [ ] **Step 4: Render at full scale in all three modes and open all three**

```bash
node packages/cli/dist/uidx.js render design-systems/meridian survey.uidx -o /tmp/survey.png --scale 1
open /tmp/survey.png
```

Check: nothing boxed sits on the sphere; the two gutters are balanced; the legend reads as HUD and not as a widget.

- [ ] **Step 5: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: survey, the world at a glance"
```

---

### Task 16: `inspect` — station `dock`

**Files:**
- Create: `design-systems/meridian/build/screens/inspect.mjs`

**Interfaces:**
- Consumes: as Task 15, plus `Feed`.
- Produces: the screen that demonstrates the concept's headline arrangement.

Contents, from spec §5.2: `Rail`; the top HUD strip; `Globe` at `station="dock"`, cropped by the right edge, rotated so the selected track sits near the limb, with a selected `Marker`; in the 976 column a dossier `Panel` (`attach="left"`) holding a header `Chip`, a `Feed`, a `Readout` grid and two `Button`s; a related-tracks `Panel` under it; and between column and sphere a bare vertical bearing ladder of `Readout`s at `micro` — HUD, unboxed, the only thing permitted in that gap.

- [ ] **Step 1: Write the descriptor with `STATION_ID = 'dock'` and the same `place()` helper**

The bearing ladder is HUD, so it is **not** passed through `place()` — it is explicitly allowed between the free region and the globe. Say so in a comment, because it is the one exception in the system and an unexplained exception becomes a habit.

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

Expected: `ok inspect.mjs`.

- [ ] **Step 3: Build**

```bash
node design-systems/meridian/build/run.mjs inspect
```

- [ ] **Step 4: Render at full scale and open**

```bash
node packages/cli/dist/uidx.js render design-systems/meridian inspect.uidx -o /tmp/inspect.png --scale 1
open /tmp/inspect.png
```

This is the screen the whole concept was pitched on — the globe holding the area on the right while the feed reads on the left. If it does not look like that, the screen is wrong, not the reference.

- [ ] **Step 5: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: inspect, one track in its place"
```

---

### Task 17: `plan` — station `horizon`

**Files:**
- Create: `design-systems/meridian/build/screens/plan.mjs`

**Interfaces:**
- Consumes: as Task 15, plus `Timeline`.
- Produces: the screen that proves "less globe when other work needs the room".

Contents, from spec §5.3: `Rail`; the top HUD strip; `Globe` at `station="horizon"`, dimmed, four `Marker`s on the visible band, the terminator crossing it; a `Timeline` filling the `top` free region with four lanes, a now-line, severity windows and a scrubber; a crew `Panel` on the right of that region holding four `Row`s in `crew` kind; and the drop hairlines from window blocks down to their markers on the dome.

- [ ] **Step 1: Write the descriptor with `STATION_ID = 'horizon'`**

The drop x positions are computed once, from the marker positions, and passed to both the `Timeline`'s `drops` prop and the `Globe`'s marker placement — one number, written once, used twice. Deriving them separately is exactly the defect `geometry.mjs` exists to prevent.

- [ ] **Step 2: Dry-run**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
```

- [ ] **Step 3: Build**

```bash
node design-systems/meridian/build/run.mjs plan
```

- [ ] **Step 4: Render at full scale and open**

```bash
node packages/cli/dist/uidx.js render design-systems/meridian plan.uidx -o /tmp/plan.png --scale 1
open /tmp/plan.png
```

Check the drop lines actually land on their markers. A drop line that misses by 4px makes the whole conceit look accidental.

- [ ] **Step 5: Commit**

```bash
git add design-systems/meridian && git commit -m "Meridian: plan, where the timeline reaches the world"
```

---

### Task 18: `desk` — station `eclipse`, then the whole system

**Files:**
- Create: `design-systems/meridian/build/screens/desk.mjs`
- Modify: `design-systems/meridian/README.md`, `backlog.md`
- Modify: `design-systems/meridian/build/all.mjs` (the final `ORDER`)

**Interfaces:**
- Consumes: everything.
- Produces: a system that rebuilds from empty with one command.

Contents, from spec §5.4: `Rail`; the top HUD strip with the 40px `Globe` at `station="eclipse"` pinned at x 1520 and its aggregate status arc; a filter bar (`Segmented` + `Button`s); a dense record table of `Row`s in `record` kind under one `header` kind; a summary rail of `Readout`s.

- [ ] **Step 1: Write the descriptor with `STATION_ID = 'eclipse'`, `attach="wide"`**

- [ ] **Step 2: Dry-run, build, render, open**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
node design-systems/meridian/build/check.mjs
node design-systems/meridian/build/run.mjs desk
node packages/cli/dist/uidx.js render design-systems/meridian desk.uidx -o /tmp/desk.png --scale 1
open /tmp/desk.png
```

The 40px globe must still read as Earth. If it reads as a dot, its dot budget is too low or its land rings are too fine at that radius.

- [ ] **Step 3: Rebuild the whole system from empty**

```bash
node design-systems/meridian/build/all.mjs
```

Expected: every page builds in order, `measure.mjs --check` agrees with `geometry.mjs`, and the four screens build last. A failure here means `ORDER` is wrong — fix the order, not the pages.

- [ ] **Step 4: Evidence E4 — render one intermediate frame between two stations**

Add a temporary station midway between `full` and `dock` (cx 1146, r 354), render the globe at it, and put the three PNGs side by side in the README. This is the evidence for law 3 — that the sphere is one object that travels rather than four unrelated drawings. Remove the temporary station afterwards; keep the image.

- [ ] **Step 5: Evidence E5 — open all twelve screen renders**

```bash
export PATH=$HOME/.nvm/versions/node/v22.15.0/bin:$PATH
for s in survey inspect plan desk; do
  node packages/cli/dist/uidx.js render design-systems/meridian $s.uidx -o /tmp/$s.png --scale 1
done
open /tmp/survey.png /tmp/inspect.png /tmp/plan.png /tmp/desk.png
```

Then set `modes={{ color: 'limb' }}` on each screen's root and repeat, then `living`. **Twelve renders, opened and looked at.** This is the step most likely to be skipped under time pressure; spec §9 lists it as evidence so that skipping it has to be written down rather than merely happen. Record what you saw in `backlog.md`, including what looked wrong and was left.

- [ ] **Step 6: Finish the README**

Write: the three laws; the station table; the renderer facts from Task 3; the page list; "Building something new with Meridian" (bind never type, size relatively, write the descriptor, register your height, place through the gates); the contrast policy; and a **Deviations** section stating every place the build departed from the spec and why.

- [ ] **Step 7: Final audit and commit**

```bash
node packages/cli/dist/uidx.js audit design-systems/meridian
git add design-systems/meridian && git commit -m "Meridian: desk, and a system that rebuilds from empty"
```

---

## Self-Review

**Spec coverage.** §1 laws → Tasks 1 (contract), 4 (gates), 18 (E4). §2 scope → the 12 components in Tasks 9–14 and the 4 screens in 15–18; §2.1's check → Task 8 Step 2. §3 canvas and stations → Tasks 1, 4, 5. §4 modes and palette → Tasks 1, 6, 12 Step 5. §5 screens → Tasks 15–18. §6 components → Tasks 9–14, one component per named subsection. §7 architecture → Tasks 2, 4, 5, 6, 8; §7.4 measurement → Step 5 of every component task. §8 renderer facts → Task 3. §9 evidence E1→Task 1, E2→Task 3, E3→every component Step 5, E4→Task 18 Step 4, E5→Task 18 Step 5, E6→Task 6. §10 risks → the dot budget in Task 12 Step 2, the domain-glyph check in Task 10 Step 4, the horizon arithmetic in Task 4's test. §11 M1–M4 → Task 1 Step 5.

**Placeholder scan.** No "TBD", no "similar to Task N", no "add error handling". Each component task names its axes, props, parts and token bindings explicitly. The one repeated structure — the five build steps — is written out in full in each task rather than cross-referenced.

**Type consistency.** `clearOfGlobe(name, box, station)` and `onFreeSide(name, box, station, attach)` keep the same signatures in Task 4's implementation, Task 4's test, and Tasks 15–18's `place()` helper. `fits(panel, holds, gap, body)` matches Vantage's existing signature and Task 15's call. `STATION[id].free` is keyed by `attach` in Task 4 and read by the same keys in Tasks 15–18. `H` keys (`chip`, `button`, `readout`, `marker`, `rail`, `segmented`, `panel`, `row`, `globe`, `feed`, `timeline`) match the `// H:` markers in Task 5 and the components that fill them.

**One gap found and closed while reviewing:** the spec's §6.6 `attach` axis said `left · right · bottom`, but `bottom` names no free region in any station, so `onFreeSide` could not have checked it. The spec was corrected (commit `6ea89d6`) to `left · right · top · wide` before this plan was written, and Task 13 uses the corrected vocabulary.
