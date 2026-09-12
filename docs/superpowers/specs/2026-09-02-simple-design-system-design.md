# Simple — a design system in the register of the Ericsson Design System

Approved 2026-09-02. *Simple* is a uidx design system authored in the visual
register of the Ericsson Design System (EDS): a dark, dense, data-first
dashboard language with a light theme for text-heavy screens. It is
EDS-inspired, not EDS — its own name, its own files, and Inter standing in
for Hilda.

## Research grounding

Three references were studied (a fleet dashboard, a system dashboard on a
laptop, and the same dashboard at full size) and the public LESS port of EDS
1.x (`Verten/umi_design`, `src/assets/variables/{global,dark,light}.less`,
`src/components/button/styles/button.less`). Pixel sampling of the
screenshots confirmed the LESS values: system bar `#0C0C0C`, app bar
`#181818`, cards `#242424`, criticality red `#DC2D37`, yellow `#DCAF00`, low
gray `#767676`.

What the references say, distilled:

- Surfaces are three stacked layers and the layer step is the only
  separator. No shadows. Regions separate by a 1px hairline (solid between
  cards, dotted between table rows and list rows) or by a layer change.
- Corners are near square: 3 on controls, 4 on cards.
- Colour means something or it is not used. One brand blue, four status
  hues, everything else neutral. Data marks are white by default; red,
  orange and yellow only when the data is in trouble.
- Type is light. Big figures are the lightest weight at 32–48px; captions
  are 12px at 60% white; titles are 16px medium; the app title is 20px.
- Data marks are thin: 1px polylines, 3px timeline bars, 2×8 gauge ticks, a
  6px progress arc on a 1px ring.

## Document

- Root: `design-systems/simple/` with its own `uidx.json`
  (`{ "id": "simple", "files": ["*.uidx"] }`). Names are global per
  document, so nothing here collides with `examples/`.
- Pages: `tokens.uidx`; one component documentation page per component
  below, named after the component in kebab-case; `dashboard.uidx`, an
  in-context page composed from instances only.
- Every component page follows the twelve-section order of
  `examples/checkbox.uidx` (cover, overview, anatomy, properties, states,
  measurements, in-context, guidance, accessibility, content, related,
  changelog). Prose is tighter than the exemplar; no section is skipped.
- Pages render in dark mode by default. Each component page's `in-context`
  section carries one light-mode frame via a node-level
  `modes={{ color: 'light' }}` override, so both themes are seen without a
  second page.
- The `<Component>` is a page child parked at `x={1700}` beside the doc
  frame, captioned as the source.
- Every fill and number on every page binds a token. Raw numbers appear
  only inside `characters` (documenting a value) and in vector geometry.

## Tokens

All collections live in `tokens.uidx`. Tier is declared on the collection.

### Primitive

`space`: hair 1, xs 4, sm 8, md 16, lg 24, xl 32, xxl 48.
`radius`: control 3, card 4, pill 999.
`type`: caption 12, body 14, title 16, heading 20, display 32, hero 48.
`size`: bar 48 (app bar and system bar height), nav 248, control 32,
input 28, icon 16, dot 8, hub 24, gauge 200, radial 140.
`weight` (documented as numbers, applied through `fontWeight`): light 300,
regular 400, medium 500, bold 700.

`palette` (COLOR):

| name | hex |
|---|---|
| black-12 | #0C0C0C |
| black-24 | #181818 |
| black-36 | #242424 |
| black-45 | #2D2D2D |
| black-51 | #333333 |
| gray-64 | #404040 |
| gray-78 | #4E4E4E |
| gray-118 | #767676 |
| gray-176 | #B0B0B0 |
| gray-200 | #C8C8C8 |
| gray-224 | #E0E0E0 |
| gray-235 | #EBEBEB |
| gray-242 | #F2F2F2 |
| white | #FAFAFA |
| blue | #0082F0 |
| blue-light | #33A3FF |
| blue-hover | #2696F2 |
| purple-dark | #8E45B0 |
| purple-light | #A56EBE |
| green-dark | #288964 |
| green-light | #34B07F |
| yellow-dark | #DCAF00 |
| yellow-light | #F2C618 |
| orange-dark | #E66E19 |
| orange-light | #F78521 |
| red-dark | #DC2D37 |
| red-light | #F52323 |

### Semantic — `color`, modes `dark` and `light` (dark is the default)

| token | dark | light |
|---|---|---|
| layer-0 | black-12 | black-12 |
| layer-1 | black-24 | gray-224 |
| layer-2 | black-36 | gray-242 |
| layer-raised | black-51 | white |
| text | gray-242 | black-36 |
| text-muted | gray-242 at 60% | black-36 at 60% |
| text-inverse | black-24 | gray-224 |
| brand | blue | blue |
| brand-hover | blue-hover | blue-hover |
| link | blue-light | blue |
| ok | green-dark | green-light |
| warn | yellow-dark | yellow-light |
| alert | orange-dark | orange-light |
| danger | red-dark | red-light |
| accent | purple-dark | purple-light |
| hairline | gray-78 | gray-200 |
| hairline-strong | gray-118 | gray-176 |
| border | gray-78 | gray-200 |
| border-hover | gray-118 | gray-176 |
| focus | blue | blue |
| disabled-surface | black-45 | gray-235 |
| mark | gray-242 | black-36 |
| mark-track | gray-64 | gray-200 |
| mark-muted | gray-118 | gray-118 |

Muted text is a separate primitive-free value (alpha 0.6 on the text
colour) declared per mode as a literal, since the palette has no alpha
steps.

### Component tier

`button`: default-border → text, default-hover-fill → text,
default-hover-text → text-inverse, primary-fill → brand,
primary-hover → brand-hover, warning-fill → danger, focus → focus.
`switch`: track → layer-raised, track-on → brand, knob → white,
border → border, disabled-track → disabled-surface, disabled-knob →
mark-muted.
`input`: fill → layer-0 at 15% (dark) / white (light), border → border,
border-hover → border-hover, border-focus → brand, border-error → danger,
placeholder → text-muted.
`table`: divider → hairline, hover → layer-raised, selected → brand at 40%,
header → text.
`map`: surface → layer-2, road → gray-78, road-major → black-12, node →
white, hub-ring → white, incident → danger, connector → gray-118.

Rule: a token references its own tier or lower, never higher.

## Components

Every component is one `<Component>` with the axes below; anything that is
a presence or a string is a prop. Sizes given are the md size in the dark
reference at 1×.

**AppHeader** — no axes. Props `productName` (TEXT), `userName` (TEXT).
48 high, layer-0 fill, full width. Left: a 16px logo mark plus 14px
regular product name, 16px from the edge. Right: 16px user icon plus 14px
username.

**AppSubHeader** — no axes. Prop `title` (TEXT). Slot `actions`. 48 high,
layer-1 fill. Left: 16px blue hamburger glyph (three 2px bars, drawn as
rectangles), then the 20px regular title at 24px spacing. Right: the
actions slot, default content a gear icon.

**CardSurface** — axis `layer` 1 | 2. Slot `content`. Layer fill, radius
`card`, no stroke, padding `md`, vertical auto-layout, gap `md`. Layer 1 is
the page background variant, layer 2 the card.

**CardHeader** — axis `action` none | kebab | expand | filter. Props
`title` (TEXT), `subtitle` (TEXT), `showSubtitle` (BOOLEAN). One row,
space-between. Title 16px medium; subtitle 12px muted, inline after the
title with `sm` gap; the action icon 16px at the right edge.

**Tile** — same axis as CardHeader. Props `title`, `subtitle`,
`showSubtitle`. Slot `body`. A CardSurface (layer 2) whose first child is a
CardHeader and whose second is the body slot, default a muted caption.

**Label** — axes `layout` stacked | inline, `arrow` on | off. Props
`caption` (TEXT), `value` (TEXT), `suffix` (TEXT), `showSuffix`
(BOOLEAN). Caption 12px muted with a 12px arrow glyph after it at `xs`
gap; value 32px light in `text`; suffix 12px muted below (stacked) or
after the value on the baseline (inline).

**Gauge** — axis `tone` neutral | alert. Props `value` (TEXT), `unit`
(TEXT), `min` (TEXT), `max` (TEXT). A 200px square. A 270° ring of 2×8
ticks at radius 92, gap at the bottom; ticks in `mark-muted`, the filled
sweep in `mark` (neutral) or `danger` (alert) as a 3px inner arc drawn as
a vector. Centre: value 48px light, unit 12px muted under it. Under the
opening: min left and max right, 12px muted.

**RadialProgress** — axis `size` md | lg (140 / 200). Prop `value`
(TEXT). A 1px `mark-track` ring; a 6px `mark` arc from 12 o'clock
clockwise, drawn as a vector at a fixed fraction (the exemplar's 20%);
value 48px light centred; "%" 12px muted under it.

**Timeline** — composed of three components. `TimelineBar`: axis `status`
on-time | critical | major | minor; 3px tall, fill `mark`, `danger`,
`alert`, `warn`; prop `width` is geometry, not a prop. `TimelineRow`:
prop `label` (TEXT) 12px in `text` at a fixed 160px label column, then a
1px `hairline` tick, then a fixed-width track holding bars at authored
x offsets. `Timeline`: a CardSurface holding a CardHeader, a legend row
(dot plus 12px word per status, right-aligned), six rows, and an hour axis
of 12px muted labels over dotted `hairline` gridlines.

**GeoMap** — `MapMarker`: axis `kind` node | hub | incident. Node: 8px
`white` dot. Hub: 24px ring, 2px `white` stroke, 8px dot inside.
Incident: 20px ring, 2px `danger` stroke, 8px `danger` dot. `GeoMap`: a
`map#surface` frame with a vector road network (a few dozen 1–3px lines in
`road` and `road-major` drawn once), dotted `connector` lines, and a
`markers` slot of MapMarker instances.

**Sparkline** — no axes. Props `title` (TEXT), `unit` (TEXT). A 1px
`mark` polyline over four dotted `hairline` gridlines; y labels 0/2/4/6
and x labels Jan/Apr/Aug/Dec at 12px muted.

**BarStat** — no axes. Props `label` (TEXT), `value` (TEXT). 13px label
left, 13px muted value right, a 2px `mark` bar under the label at authored
width over a 1px `hairline`.

**Button** — axes `kind` default | primary | warning, `interaction`
default | hover | active | focus | disabled, `size` md | big. Props `label`
(TEXT), `showIcon` (BOOLEAN). Min width 60, padding 6/12 (md) and 8/16
(big), radius `control`, 12px (md) / 14px (big) medium label. Default:
transparent fill, 1px `text` border, `text` label; hover inverts (fill
`text`, label `text-inverse`); active fill darkened 24%. Primary: `brand`
fill, white label, hover `brand-hover`. Warning: `danger` fill. Disabled:
40% opacity. Focus: 2px `focus` outline ring frame at 1px offset.

**Switch** — axes `state` off | on, `interaction` default | hover |
disabled. Prop `label` (TEXT). Track 32×16 radius pill, 1px `border`,
fill `track`; knob 12px `white` at 2px inset; on: fill and border `brand`,
knob at the right; hover: border `border-hover`; disabled: fill
`disabled-track`, knob `disabled-knob`. Label 14px at `sm` gap.

**Input** — axes `kind` text | select, `interaction` default | hover |
focus | error | disabled. Props `label` (TEXT), `showLabel` (BOOLEAN),
`value` (TEXT). Height 28, padding 0/8, radius `control`, 1px border,
12px value. Select adds a 12px chevron at the right. Label 12px muted to
the left at `sm` gap (the reference's "Time frame  Today").

**Pill** — axes `tone` neutral | blue | green | yellow | red, `selected`
off | on. Prop `label` (TEXT). Height 20, padding 0/8, radius `pill`,
12px label; neutral is `layer-raised` fill; toned pills use the status
fill with white text; selected adds a 1px `text` border.

**Pagination** — no axes. Props `current` (TEXT), `goTo` (TEXT). Arrow,
five 12px page numbers with the current one carrying a 2px `text`
underline, arrow, "Go to" caption plus a 40px Input instance, and a
"4 entries" select at the far right.

**TableRow** — axes `role` header | body, `state` default | hover |
selected, `criticality` none | extreme | high | low. Props `cell1`,
`cell2`, `cell3` (TEXT), `percent` (TEXT). Height 32 (header) / 31
(body). Header: 13px medium cells with a 10px sort chevron. Body: an 8px
dot (`danger` / `warn` / `mark-muted`, hidden for none) before cell1, 13px
cells, a progress cell of a 2px `mark` bar over a `mark-track` bar with the
percent 12px right. Dotted `divider` under each body row. Hover fills
`table#hover`; selected fills `table#selected`.

**StatusListRow** — axis `status` progress | passed | failed. Props
`label` (TEXT), `detail` (TEXT). Height 31, 13px label left; right cluster
of a 16px icon (half `danger` ring / `white` check circle / `danger` cross
circle) and 12px detail. Dotted `divider` under.

**ActivityItem** — axis `position` first | middle | last. Props `time`
(TEXT), `text` (TEXT). A 1px `hairline` rail on the left with a 6px
`mark-muted` dot at the row's top; first and last trim the rail above or
below. 11px muted time over 13px text, `xs` gap, rows 31 apart.

## Pages beyond components

`dashboard.uidx` rebuilds the system dashboard at 1440×900 from instances:
AppHeader, AppSubHeader, a 3-column grid of Tiles whose bodies hold Gauge,
TableRow×5 with Pagination, StatusListRow×6, ActivityItem×6, GeoMap with
markers, Sparkline, BarStat×3 and Label instances. Its `## Core Intent`
names the layer ladder and the grid; nothing on it is drawn that a
component does not own.

## Accessibility, stated honestly

Each page's accessibility section carries contrast arithmetic against its
own tokens. Known failures to state rather than hide: `hairline` gray-78 on
black-36 is about 2.4:1 (WCAG 1.4.11 asks 3:1 for boundaries); `text-muted`
at 60% on black-36 is about 8:1 and passes; `warn` yellow on black-36
passes for marks but a white label on `warn` does not (about 1.9:1), so
yellow pills carry a dark label.

## Build order and verification

Tokens first, audited. Then per component page: architecture declared
with `uidx architect`; `<Component>` inserted with every variant in one
`uidx eval` batch; states grid as instances; the remaining sections one
per eval; prose via `uidx intent`; `uidx audit` between scripts. Chrome
first (AppHeader, AppSubHeader, CardSurface, CardHeader, Tile), then
controls (Button, Switch, Input, Pill, Pagination), then data (Label,
Gauge, RadialProgress, Sparkline, BarStat, TableRow, StatusListRow,
ActivityItem), then Timeline and GeoMap, then the dashboard.

Done means `uidx audit design-systems/simple` exits 0 and every page has
been rendered to PNG and looked at. One commit per page on main.

## Out of scope

Hilda (not bundled; Inter throughout). Icons beyond the ones the references
show, drawn as simple vectors. Animation. Responsive breakpoints (documented
as values in `size`, not exercised).
