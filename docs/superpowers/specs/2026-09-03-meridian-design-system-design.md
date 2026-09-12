# Meridian — a globe-stationed C4I design system

**Date:** 2026-09-03
**Root:** `design-systems/meridian`
**Status:** design approved in chat; not yet built.

## 1. The idea

Meridian is a design system for a third-party, multi-domain C4I product — a
platform sold to an operator in any domain rather than a console built for one.
Its vocabulary is therefore role-based (asset, track, corridor, window, team,
record) and **domain is a first-class filter**, not a fork of the design.

The invention is one sentence:

> **The globe has four named stations, each station is a posture of work, and
> opening a panel is what moves it.**

In every C2 product the map is a fixed pane and windows pile on top of it. In
Meridian the map is the camera. Navigation and camera motion are the same act:
asking for a track's dossier docks the globe to the right to open a reading
column; opening a mission plan sinks it to a horizon so the timeline gets the
screen; opening a record table eclipses it to a 40px sphere in the top bar that
is still turning and still carrying aggregate state.

### 1.1 Why this shape

Three findings, in order of how much they changed the design:

- **Focus+context beats overview+detail and beats plain zooming on task
  time.** So the globe must never be *replaced* by another view or hidden
  behind a tab — it changes weight, continuously, and stays present at every
  station. This is the argument for the Eclipse station existing at all.
- **Porting a flat dashboard into depth fails because it keeps the visual layer
  and drops the interaction logic** (2026 spatial-UI writing is consistent on
  this). So the globe's *position* must carry meaning. A station is a
  statement about what the operator is doing, not a camera preset.
- **Anduril staffed a separate game-developer team (Sand Table) because their
  React operator UI could not make the live 3D command picture feel real.**
  That gap is the room this concept stands in: the aim is a console that reads
  as an instrument you trust and a place you inhabit, in a flat renderer.

### 1.2 The three laws

1. **Panels declare their station, not their position.** A panel has no free
   coordinates. It names the station whose free region it lives in. This is
   what makes the concept a system rather than four hand-built layouts, and it
   is what §7's checks can enforce.
2. **HUD and floating are two classes of surface and nothing is both.**
   *HUD* is bare type and marks laid directly on the void or the sphere — never
   boxed, never filled — anchored to a screen edge or to the bearing ring; it
   carries what must always be visible. *Floating* is a filled panel with a
   hairline; it exists only at a station that made room for it, and it always
   sits on the side away from the globe.
3. **The globe never cuts — it travels.** The same sphere at the same rotation,
   only re-stationed. uidx renders frames, not motion, so this system states the
   transit and renders the stations; one intermediate frame is rendered as
   evidence that the sphere is one object (§9, E4).

### 1.3 Relationship to Vantage

`design-systems/vantage` is already a C4I game-HUD system (dark slate, spring
green, `tactical-map` + `hud-bar` + `floating-panel`). Meridian must not be a
Vantage restyle. It differs on the idea (the station choreography, which
Vantage has no equivalent of), on the register (etched instrument, three modes,
a constructed sphere rather than a flat tactical map), and on the canvas
(1600 × 1000 with a 72px rail, against Vantage's 1440 × 900 with 36).

Meridian inherits Vantage's *method* wholesale and says so: bind-never-type,
one number written once, measured component heights, computed contrast rows,
and gates that refuse work that does not fit.

## 2. Scope

**In:** 12 component pages and 4 screens.

| | pages |
|---|---|
| foundation | `tokens` |
| chrome | `rail`, `panel` |
| controls | `button`, `segmented` |
| data | `readout`, `chip`, `row`, `marker`, `timeline`, `feed` |
| spatial | `globe` |
| screens | `survey`, `inspect`, `plan`, `desk` |

**Out, deliberately, and recorded in the backlog on day one:**

- **No `input`.** The Desk filter bar uses `segmented` plus a button. A search
  field is backlog **M1**.
- **No pagination.** The Desk table ends. Backlog **M2**.
- **No motion.** The renderer draws frames.
- **No projection library, and no new dependency.** Vantage already decodes
  Natural Earth 1:50m land (`world-atlas@2.0.2`, public domain) from a checked-in
  545KB TopoJSON in `build/lib/coast.mjs`, in forty lines and with no package.
  Meridian ports that decoder and gives it an **orthographic** projection
  instead of Vantage's equirectangular one, so the sphere carries real
  coastlines rather than an invented land mask (§6.2).

**Two consolidations, made as design decisions rather than budget cuts:**

- **The bearing ring folds into `globe`.** At the Eclipse station the ring *is*
  the globe; they were never separable, so the ring is a part of the globe
  component and is documented on its page.
- **`row` is one component doing four jobs** — priority track, related track,
  crew member, table record — behind a `kind` axis, because they are the same
  object at four densities.

### 2.1 The scope risk, stated plainly

A thin library plus four screens is the configuration in which screens quietly
draw bespoke parts, which is precisely the failure Vantage's `fits()` and
measured-height discipline exists to prevent. Two mitigations are built into
this spec rather than left to good intentions:

1. **The library is derived from the screens, not guessed.** §5 sketches the
   four screens; §6's component list is the extraction from them. Every axis in
   §6 exists because a screen in §5 asked for it.
2. **Screens compose instances only.** A screen that needs a shape the library
   does not have either promotes that shape to a component or changes. This is
   checked, not trusted: `build/check.mjs` refuses a screen descriptor that
   creates a drawing primitive outside an instance (§7.3).

## 3. Canvas and stations

Constants at every station:

| | value |
|---|---|
| screen | 1600 × 1000 |
| left rail | 72 wide, full height, x 0–72 |
| top HUD strip | 64 tall, x 72–1600, y 0–64, **bare** — no fill |
| content region | x 72–1600, y 64–1000 (1528 × 936) |
| content centre | 836, 532 |
| margin / gap | 24 / 16 |

1600 × 1000 rather than Vantage's 1440 × 900 because the Horizon station must
give a timeline 588px of working height above the dome, and 900 does not have
it to give.

**The station boxes.** These are the `station` token collection and
`build/lib/stations.mjs`; they are written once, here, and never typed again.

| station | globe | free region |
|---|---|---|
| `full` | cx 836, cy 532, r 372 | `left` x 96–440, `right` x 1232–1576 — both 344 × 888 (y 88–976) |
| `dock` | cx 1456, cy 532, r 336 — 192px of sphere off the right edge | `left` — the reading column, x 96–1072, 976 × 888 |
| `horizon` | cx 836, cy 1600, r 900 — dome tops out at y 700, arc exits the bottom edge at x 165 and x 1507 | `top` — the work surface, x 96–1576, y 88–676, 1480 × 588 |
| `eclipse` | cx 1520, cy 32, r 20 — pinned in the top HUD strip | `wide` — the whole content region, x 96–1576, y 88–976, 1480 × 888 |

Horizon's arithmetic, since it is the one that is not obvious: with `r` 900 and
`cy` 1600 the dome's apex is at y 700, and at the bottom edge
`dx = sqrt(900² − 600²) = 671`, so the arc leaves the screen at x 836 ± 671 —
inside the content region at both ends. The dome therefore spans nearly the
full width and reads as a horizon rather than as a circle poking up.

**Station semantics**, which is what a panel is declaring when it names one:

| station | posture | the operator is |
|---|---|---|
| `full` | survey | asking what is happening everywhere |
| `dock` | inspect | asking about one thing, in its place on the world |
| `horizon` | plan | working in time or in people, with the world still in view |
| `eclipse` | desk | doing work that is not spatial at all |

## 4. Modes

Three colour modes over **one geometry**. Every difference between modes lives
in the colour tier; nothing structural forks. The globe always draws its dot
field, its graticules and a fixed ladder of limb bands — the modes only
re-colour them, which is how a terminator is achieved in a renderer that has no
gradients (§8).

| mode | ground | chrome | globe | signal |
|---|---|---|---|---|
| `etched` | near-black, faintly cool | greys carry all structure; hairlines and tracked caps do the work | drawn in greys; **every limb band resolves to the same value, so the terminator is flat** | `ice` — cold, instrument-like |
| `limb` | deep navy-black | panels a touch warmer, more filled | **limb bands ramp** from a lit edge through to shadow; warm atmosphere ring | `solar` — warm, sunrise |
| `living` | true black, zero chroma in chrome | chrome collapses to neutral grey; nothing in the furniture is coloured | bands ramp at high chroma; markers at full saturation | `flare` — hottest |

`living` is a policy expressed as colour: all light and colour belong to the
globe and to things happening now, and the surrounding UI never competes.

**Cost, acknowledged:** three modes means every contrast row, every render and
every QA pass is 3×, where Vantage carried 2. §7.2 makes the contrast part of
that automatic; the render/look part is not automatic and is budgeted in §9.

### 4.1 Palette

`palette` is primitive and per-mode ramps are named by mode. Values below are
the design intent; **they are re-derived by sampling in Phase 1 (§9, E1) and
the tokens page is the contract if the two disagree.**

Ground ramps, 0 (void) → 9 (text), each mode:

| step | `etched` | `limb` | `living` |
|---|---|---|---|
| 0 void | `#05070A` | `#04060E` | `#000000` |
| 1 | `#0A0D12` | `#070B16` | `#070707` |
| 2 panel | `#10141B` | `#0B1220` | `#0E0E0E` |
| 3 panel-raised | `#161B24` | `#111A2C` | `#151515` |
| 4 hairline | `#1E2530` | `#1A2740` | `#1E1E1E` |
| 5 | `#2A323F` | `#243352` | `#2A2A2A` |
| 6 hairline-strong | `#3A4453` | `#33456A` | `#3C3C3C` |
| label | `#6B7688` | `#6C7C9B` | `#6E6E6E` |
| 7 | `#8C97A8` | `#8F9DB8` | `#909090` |
| 8 text-muted | `#B4BDC9` | `#B7C2D6` | `#B8B8B8` |
| 9 text | `#E8ECF1` | `#E9EEF7` | `#EDEDED` |

Signal, one per mode: `ice #9FE8FF` · `solar #FFB35C` · `flare #FF3D81`.

Status set, **shared by all three modes** so an operator never relearns it —
this is the `CRITICAL / DELAYED / MEDIUM / ACTIVE` quartet of the reference,
generalised:

| token | value | means |
|---|---|---|
| `critical` | `#FF4D6A` | acting now |
| `warn` | `#FFB020` | slipping |
| `watch` | `#4DA6FF` | worth an eye |
| `nominal` | `#3DDC91` | fine |

Domain hues are **not** a fifth colour dimension: a domain is carried by a
marker *glyph* (§6.3), never by hue, because hue is spoken for by status. This
is the single most important palette decision in the system and the one most
likely to be eroded later.

### 4.2 Semantic colour tokens

`color`, tier semantic, `modes={['etched','limb','living']}`: `void`,
`ground-1`, `panel`, `panel-raised`, `hairline`, `hairline-strong`, `text`,
`text-muted`, `label`, `text-inverse`, `signal`, `signal-deep`, `critical`,
`warn`, `watch`, `nominal`, `selection`, `focus`, `mark`, `mark-track`,
`sphere-dot`, `sphere-grid`, `limb-0` … `limb-4`, `terminator`, `glow-signal`,
`glow-critical`, `glow-nominal`, `on-dark`.

`limb-0…4` is the band ladder that makes the terminator. In `etched` all five
resolve to the same value; in `limb` and `living` they ramp.

Frame fill alpha is not honoured by this renderer (§8), so every translucent —
`panel`, `panel-raised`, `selection`, every `glow-*` — is a **pre-blended
literal per mode**, and the tokens page says which values are derived and from
what.

### 4.3 Scales

- **space** 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64
- **radius** `none` 0 · `sm` 3 · `md` 6 · `lg` 10 · `pill` 999
- **stroke** `hair` 1 · `mark` 1.5 · `ring` 2 · `arc` 3 · `limb` 4
- **type** `micro` 9 · `caption` 11 · `body` 13 · `label` 15 · `title` 18 ·
  `head` 24 · `hero` 40 · `mega` 64
- **size** `rail` 72 · `hud` 64 · `icon` 20 · `icon-lg` 28 · `marker` 24 ·
  `marker-lg` 32 · `chip` 22 · `row` 44 · `row-dense` 32 · `lane` 56 ·
  `feed-h` 320 · `tick` 6

**Type voice.** All data, readouts, coordinates and table cells are set in a
monospace face; panel titles and hero figures in a grotesque. `micro` is always
tracked caps (`letterSpacing` 1.5), which Vantage measured as real in this
renderer. The exact family names must be probed before the build, not assumed
(§9, E2), and `fontWeight` is confined to 400–800 because Vantage measured 300
and 900 as painting nothing at all while still auditing clean.

## 5. The screens

### 5.1 `survey` — station `full`

The world at a glance. Sphere centred with its bearing ring; markers across all
five domains; tracks arcing between them.

- **Left gutter** (344): one floating panel — operating picture: timestamp, the
  at-risk line, and the single contact that matters, as a `row`.
- **Right gutter** (344): bare HUD `readout`s giving per-domain counts, above a
  floating priority-tracks panel of three `row`s with trend.
- **Bottom edge**: the severity legend as bare HUD — four `chip`s in `dot`
  variant with tracked-caps labels, no box.
- **Domain filter**: arcs on the bearing ring, mirrored by a `segmented`
  control at top-right so the control is reachable and the ring is the display.

### 5.2 `inspect` — station `dock`

One track, in its place. The globe is docked right and cropped, turned so the
selected track sits near the limb, with a selection halo on it and its bearing
called out on the ring.

The 976 column on the left carries the dossier: a `panel` whose header holds
the track id and a severity `chip`; a **`feed`** block beneath it — a framed
still with scanline hairlines, a reticle and a timecode, which is the "video
opens floating on the left while the globe holds the area on the right"
arrangement; then a `readout` grid and two actions (primary + ghost). A
related-tracks `panel` sits under it.

Between the column and the sphere runs a bare vertical bearing ladder —
`readout`s at `micro` plus a rule. It is HUD, unboxed, and it is the only thing
permitted in the gap between the free region and the globe.

### 5.3 `plan` — station `horizon`

Time and people. The dome sits across the bottom, dimmed, with four markers on
the visible band and the terminator crossing it.

Above: a `timeline` of four lanes with a now-line, severity-coloured windows
and a scrubber, and a floating crew `panel` on the right holding four
`row`s in `crew` kind.

**The detail that makes this more than a layout:** window blocks drop hairlines
down to the markers they belong to on the dome. The plan and the world are
visibly the same object, which is the whole argument for keeping the globe on
screen while doing temporal work.

### 5.4 `desk` — station `eclipse`

The globe eclipsed to a 40px live sphere in the top bar, still turning, its ring
now an aggregate status arc. The content region becomes a dense record table —
`row` in `record` kind, with a `header` kind for the column heads — under a
filter bar (`segmented` + buttons) and beside a summary rail of `readout`s.

This station is what makes the concept honest: it admits that some work is not
spatial, and keeps the world present at a cost of forty pixels rather than
hiding it behind a tab.

## 6. Components

Every component states tier, axes, props, parts and the screens that ask for
it. Axis names avoid `status`, which is reserved for a component's lifecycle.

### 6.1 `tokens`
Foundation. Three tiers (`primitive`, `semantic`, `component`), three modes, and
the `station` collection of §3. No canvas — the format permits exactly one root
element and a `<Tokens>` file cannot also hold a `<Page>`, so the contract is
carried in the page's `## Design` and `## Tokens` prose, as in Simple and
Vantage.

### 6.2 `globe` — spatial tier. The heart.
**Axes:** `station` (full · dock · horizon · eclipse).
**Props:** rotation index, marker set, track set, terminator index, ring mode.
**Parts:** dot field · graticules · limb band ladder · terminator · atmosphere
ring · bearing ring (ticks, domain arcs, sun index, selected bearing) · marker
layer · track arcs.

The sphere is *constructed*, never photographic: the renderer knows `SOLID`
fills and nothing else. `build/lib/sphere.mjs` ports Vantage's TopoJSON decoder
and adds the orthographic projection, the visible-hemisphere test (a point is
drawn only where its `z` is positive) and a point-in-ring land test, so a dot is
placed on land because it *is* on land. The dot field is generated with a node budget —
**≤ 450 dots at `full`, scaled down by station** — because a page is a scene
graph and an unbudgeted field is how a component becomes unopenable. Graticules
are `Vector`s; land rings are closed and graticule lines are open, and the two
never share a Vector, because this renderer silently drops a subpath that mixes
closed and open in one path.

At `eclipse` the ring *is* the component: a 40px sphere and its status arc.

### 6.3 `marker` — data tier
**Axes:** `domain` (land · sea · air · space · cyber → five glyphs),
`severity` (critical · warn · watch · nominal), `selection` (none · selected).
Domain is glyph, severity is hue (§4.1). Selected draws a dashed halo — a
`Vector` with `dashPattern`, which this renderer honours on a Vector and
ignores on a Rectangle.

### 6.4 `readout` — data tier. The HUD atom.
**Axes:** `scale` (micro · normal · hero), `align` (start · end),
`tone` (plain · signal · severity).
**Parts:** tracked-caps label · value · unit. Never boxed, never filled — this
component is the concrete form of law 2. Used in the top strip, both gutters,
the bearing ladder, the Desk summary rail.

### 6.5 `rail` — chrome tier
**Axes:** `state` per item (rest · hover · active · alert).
72 wide, full height, a column of icon buttons as rounded pills with the active
item carrying the signal hue. The one piece of furniture present at all four
stations.

### 6.6 `panel` — chrome tier. The floating surface.
**Axes:** `size` (sm · md · lg), `attach` (left · right · top · wide),
`tone` (plain · alert).
**Parts:** header (title, optional `chip`, optional close) · body slot ·
optional footer actions. A slot fill carries content only; the declared slot
lays it out. `attach` is not decoration — it is the panel naming which free region of
its station it binds to, and §7.3 checks it. The four values are the free-region
keys of §3 and nothing else: `full` offers `left` and `right`, `dock` offers
`left`, `horizon` offers `top`, `eclipse` offers `wide`. `bottom` names no free
region in any station and is therefore not a value.

### 6.7 `chip` — data tier
**Axes:** `severity` (critical · warn · watch · nominal),
`variant` (solid · outline · dot).

### 6.8 `button` — controls tier
**Axes:** `kind` (primary · ghost · icon), `state` (rest · hover · active ·
disabled).

### 6.9 `segmented` — controls tier
**Axes:** `size` (sm · md), `count` (2 · 3 · 4 · 5).
The domain filter and the Desk filter bar.

### 6.10 `row` — data tier. The workhorse.
**Axes:** `kind` (track · related · crew · record · header),
`state` (rest · hover · selected), `trend` (none · up · down).
Four jobs, one component, at heights `row` 44 and `row-dense` 32.

### 6.11 `timeline` — data tier
**Axes:** `density` (normal · dense).
**Parts:** four lanes · now-line · severity windows · scrubber · the drop
hairlines that tie a window to its marker on the dome.

### 6.12 `feed` — data tier
**Axes:** `state` (live · recorded · lost).
**Parts:** frame · scanline hairlines · reticle · timecode · source caption.
The still that stands in for a video, and the component that makes §5.2's
arrangement possible.

### 6.13 Hierarchy and build waves

```
tokens
├─ W1 (tokens only):  chip · button · readout · marker · rail · segmented
├─ W2:  panel (button, chip) · row (chip, readout) · globe (marker) · feed (readout, chip)
├─ W3:  timeline (chip, readout)
└─ W4:  survey · inspect · plan · desk   — instances only
```

The apply gate checks each op against the document as it stands, so a component
instanced by another in the same page needs its own batch, and a page whose
component instances another page's must be built after it. `build/all.mjs`
therefore states this order rather than globbing the directory.

## 7. Architecture

`design-systems/meridian`, following Vantage's layout: hand-authored
`tokens.uidx`, every other page generated from `build/components/<id>.mjs` by
`node build/run.mjs <id>`, with `build/check.mjs` dry-running every descriptor
without touching the CLI.

### 7.1 Numbers are written once

- `build/lib/n.mjs` — the binding handles. Colour, space, type, radius, size,
  stroke, plus one handle per component tier. A descriptor cannot type a value
  the tokens page does not name; `build/test/n.test.mjs` asserts every handle
  against `tokens.uidx`. Raw numbers live only in `characters`, vector path
  data, and `x`/`y`.
- `build/lib/geometry.mjs` — component heights, one marked line per component
  (`// H:<id>`), starting at `null`.
- `build/lib/stations.mjs` — §3's table, in code, where it can be added up.

### 7.2 Contrast is computed, never typed

`build/lib/contrast.mjs` reads `tokens.uidx`, follows each alias through **all
three modes**, and states the ratio against the floor the pair actually has to
clear — 4.5 for text, 3 for large text (24px and up) and for a control's edge
or a mark, and `none` for scaffolding that carries nothing. A row that fails
prints **FAILS** with its number, so a page cannot quietly list only what
passes. Every accessibility section on every page is generated by this module.

This exists because Vantage typed its ratios into prose once, and the day the
palette moved, twenty pages were confidently wrong.

### 7.3 Three gates

1. **`fits()`** — inherited. A panel's declared height must fit the region it
   is placed in, computed from measured component heights. A `null` height is
   refused rather than added as zero, so an unmeasured component cannot reach a
   screen.
2. **`clearOfGlobe(box, station)`** — a floating panel's box must not intersect
   that station's globe box.
3. **`onFreeSide(box, station)`** — a floating panel's box must lie inside that
   station's free region, on the side its `attach` names.

Gates 2 and 3 are the choreography made enforceable: they are why law 1 is a
contract rather than an intention. `build/check.mjs` additionally refuses a
screen descriptor that creates a drawing primitive outside an instance (§2.1),
a token alias inside `characters`, and a `fontWeight` outside 400–800.

### 7.4 Heights are measured, not expected

`build/measure.mjs` renders one instance of each component and reads the PNG's
own IHDR header. Each component owns one marked line in `SPECS`, commented out
until measured; `node build/measure.mjs --check` reports the drawn height, and
that number — not the expected one — goes on the `H` line.

## 8. Renderer facts this design is built around

Confirmed in this repo before writing this spec:

- **`SOLID` fills only.** `packages/schema` knows no gradient and no image
  fill. A photographic Earth is impossible; the terminator is a ladder of
  banded solid fills (§4, §6.2), which is why one geometry can serve three
  modes.
- **Frame fill alpha is not honoured.** Every translucent is a pre-blended
  literal per mode.
- **`render` defaults to `--scale 0.5`.** Every measurement is half unless
  `--scale 1` is passed.

Carried from Vantage's probes and re-verified in Phase 1 (§9, E2):
`letterSpacing` and `textCase="UPPER"` render; `dashPattern` renders on a
`Vector` and not on a `Rectangle`; `fontWeight` 300 and 900 paint nothing while
auditing clean; `layoutWrap="WRAP"` works; a `strokeWeight` bound to a token
renders at the bound value as of `766e136`; a Vector's subpaths must be all
closed or all open; a Vector's path data does not scale to its declared box, so
icon sizes scale the numbers.

## 9. Evidence the build owes

| id | evidence | where it lands |
|---|---|---|
| E1 | Palette re-derived by sampling the reference images, not carried from §4.1 by faith | `tokens.uidx` `## Design`; §4.1 superseded if they disagree |
| E2 | Renderer probes re-run in this root, including the two font families | `README.md` "Renderer facts" table |
| E3 | Every component height measured from its own PNG header | `geometry.mjs` `H` lines |
| E4 | One intermediate frame rendered between two stations, proving law 3 | `README.md` |
| E5 | All four screens rendered and **opened** in all three modes — 12 renders looked at, not merely produced | build log / backlog |
| E6 | Contrast rows generated for three modes; failures stated on their own pages | every page's accessibility section |

E5 is the expensive one and the one most likely to be skipped under time
pressure. It is listed as evidence precisely so that skipping it has to be
written down rather than merely happen.

## 10. Risks

| risk | mitigation |
|---|---|
| Thin library + four screens → screens draw bespoke parts | Library derived from screens (§2.1); `check.mjs` refuses primitives in a screen descriptor |
| Three modes → 3× QA, and the third mode silently rots | Contrast is generated for all three (§7.2); E5 requires all twelve renders be opened |
| The dot field makes `globe` an unopenable page | Node budget: ≤ 450 dots at `full`, scaled by station (§6.2) |
| Domain hue creeps in beside status hue | Stated as the palette's load-bearing decision (§4.1); domain is glyph, always |
| Horizon's dome reads as a circle, not a horizon | Arithmetic fixed in §3; the arc must exit the bottom edge inside the content region |
| Meridian reads as a Vantage restyle | §1.3; different idea, register, canvas and modes — and the station gates have no Vantage equivalent |

## 11. Open, and deliberately deferred

- **M1** `input` / search field.
- **M2** pagination for the Desk table.
- **M3** a drawn `foundations` swatch board, since `tokens.uidx` can carry no
  canvas.
- **M4** a fifth station (`split`, two hemispheres side by side for comparing
  two areas) — attractive, unproven, and out of this scope.
