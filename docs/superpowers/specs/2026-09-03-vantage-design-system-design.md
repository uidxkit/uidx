# Vantage — a game-HUD design system for a C4I operations console

Approved 2026-09-03 (modes, gamification depth, scope and name chosen by the
user). *Vantage* is a uidx design system for a mission-critical command,
control, communications, computers and intelligence (C4I) console. Its register
is a game HUD: the geographic map is the floor of every screen, every other
element floats over it, and operational state is shown the way a game shows
progress — rings, ranks, objectives, a mission clock — while every element
reports something real. It lives at `design-systems/vantage/` and is built the
way Simple (`design-systems/simple/`) is built: descriptors, a generator, a
geometry module, three checks and a review loop. The playbook is the repo skill
`uidx-design-system`; this spec adds what is specific to Vantage.

## Research grounding

Ten reference images were studied at 2× crops. None is fetchable by a later
agent, so each is distilled here into appearance lines. Colours were read from
the pixels, not guessed.

**R1 · dotted-map travel page (teal).** Radial teal glow, brighter at centre
(`#1F6B69` → `#0E3A3A` at the edges). Continents as a dot matrix of light
dots on a ~6px pitch. Dashed vertical meridians the full height of the map. One
accent, orange, spent on a plane glyph and a thin flight path. Landmarks as
small black silhouettes at their coordinates. Chrome: a glossy black top bar
with a search field; bottom band of black with login and services blocks.

**R2 · Counterspill (teal, data bubbles).** Sea `#1E5C5C` with a paper
texture; land is *darker* than sea (`#0E2F2F`). Data as translucent orange
and red discs sized by magnitude, 30–60% alpha, overlapping. A bottom
timeline 1910–2030: a 1px rule with ticks every decade, category-coloured
dots on it, bracket handles at both ends. A legend row: coloured dot, tracked
caps label. A "Filter Disasters" block button in a lighter teal at the bottom
right. Top: black bar with logo and search; a dark-red nav strip below it.

**R3 · Spotify "Eye of the Stormers" (gold on near-black).** Ground `#1A1512`.
The globe is outline only: coastlines and borders in thin gold (`#C9A35A`)
at about 1px; graticule in the same gold at low alpha. Histogram bars radiate
from the rim. Left rail: ten ranked cities — caption in tracked small caps,
10px gold, figure 20px white with thousands separators. Bottom: a histogram
timeline with a gold playhead and date under it. Top right: an outline pill
button, gold stroke, tracked caps label. Nav is tiny tracked caps at the
top centre.

**R4 / R5 · Statskog Millionen (deep green).** Ground is a radial green
gradient, `#0B3B2E` at centre to `#04231B` at the edges. Norway is a flat
silhouette one step lighter (`#1D5A47`), no outline. Data as white dots with a
soft glow, three sizes (2, 4, 7px), clustering into bright masses. Left rail:
time periods stacked, serif, the selected one white at full size, the rest at
40% and smaller, with a tiny tracked caps eyebrow (HØST / VÅR) over each. A
floating detail card near its dot: pale mint surface (`#CFE2DC`), photo
bleeding off the left edge, serif title, a figure ("kr 10 000"), a chevron.
Bottom left: a two-segment toggle (Kart / Liste) whose segments are
parallelograms with slanted dividers. Bottom right: an outline ghost button
with a caps label, and above it a zoom stack of two outlined squares
(+ / −). Chrome is otherwise three small items: logo, search, menu.

**R6 · TFI world map (light).** White ground; the map as a light-gray dot
matrix; circular avatar clusters at each region with a region label in
tracked caps below. A thin black bar at the top. The light-mode proof that a
dot-matrix map reads at any polarity.

**R7 · SlideSafe city map (charcoal).** The map users called "amazing gray":
ground `#1B1C1E`, streets as lines one step lighter (`#26272A`, about 5%
luminance apart), water darker than land. Pins are 16px rounded squares in
yellow (`#F5C542`), cyan (`#3EC6C6`) and orange, with a glyph inside; one white
location pin. A floating chat panel (`#242628`) with cyan message bubbles and
a header strip. A vertical icon rail at the right edge: 32px squares stacked
(layers, zoom, locate). Bottom left: user chips, avatar + name. Top: a slim tab
strip ("Map overview") on a black bar. Nothing on the map has a shadow; the
surface step does the separating.

**R8 / R9 · "It's a jungle out there" / "A winter wonderland" (slate HUD).**
Ground slate `#262B33` with a faint dot texture; continents `#2F3541`.
Entity markers are 12px colour rings (cyan, magenta, orange, green) with a
big light numeral beside each (28px, weight 300: "05", "03", "02"); the
selected one carries a dashed circular halo about 36px across. Floating
panel `#1C2027` with a black header strip (`#14171C`): a green (`#3DDC84`)
1.5px polyline with white 4px dots on a gray bar track, day labels in 9px caps,
a timestamp block at the right of the header. A big glyph tile (a heart) beside
it. Icon tabs top right on a black strip. The hero label under the map:
"+ 04" figure 40px light, a title in 18px tracked caps, a subtitle, and
coordinates ("58.6653°N 16.4664°E") in a mono-style caption, with a 2px green
rule under the numeral. The weather variant: "−3°C" at 32px, a cloud glyph, a
cyan ring, a photo thumbnail card with a play button.

### What the references agree on

1. **The map is a silhouette, not a picture.** Land is a flat tone one step
   from the sea, or a dot matrix. No tiles, no labels, no relief. That is what
   keeps a hundred entities legible.
2. **One hue owns the screen.** Green, gold on black, or blue-gray charcoal.
   Accent colour is spent only on data: dots, rings, pins, one chart line.
3. **The map is the floor; everything floats.** A rail of ranks or filters
   at the left, a detail card near its entity, a chat or chart panel, an icon
   rail at the right edge, a scrubber along the bottom. Chrome is a strip.
4. **No shadows.** A floating panel separates from the map by a surface step
   and a hairline. Translucency is pre-blended (frame fill alpha is not
   honoured).
5. **HUD typography.** Figures are large and light; captions are tiny tracked
   caps; coordinates and clocks are mono-style; the selected thing is marked by
   a ring, a dashed halo and bracket corners, never by a colour change alone.
6. **Selection and affiliation are separate axes.** What an entity *is*
   (friendly, hostile, neutral, unknown) and whether it is *selected* are
   different questions, read across and down the same grid.

## Document

- Root `design-systems/vantage/`, `uidx.json` `{ "id": "vantage", "files": ["*.uidx"] }`.
  Names are global per document, so nothing here collides with Simple.
- Pages: `tokens.uidx` (hand-authored); one doc page per component below
  (kebab-case); `ops.uidx`, the screen, composed from instances only.
- Component pages follow the twelve-section order and carry the computed
  `## Spec`, as Simple's do; the generator is forked from Simple's `build/lib`.
- Pages render in graphite by default. Each component page's in-context
  section carries one verdant frame via `modes={{ color: 'verdant' }}`. The
  screen carries the same composition twice: graphite and, below it, verdant.
- Font is Inter (the bundled faces). Weight 300 does not exist; 400 stands in
  for "light" at large sizes, as Simple found. Tracked caps use `letterSpacing`
  and `textCase="UPPER"` if the renderer honours them — the foundation build
  probes both and records the answer in the README.

## Tokens

### Primitive

`space`: hair 1, xs 4, sm 8, md 12, lg 16, xl 24, xxl 32, xxxl 48.
`radius`: control 4, panel 6, pill 999, marker 999.
`type`: micro 10, caption 12, body 14, title 16, heading 20, figure 28,
display 40, hero 56.
`size`: hud 44, rail 36, control 32, input 32, icon 16, icon-lg 20, dot 6,
marker 12, marker-ring 20, halo 32, ring-sm 32, ring-md 64, ring-lg 96,
pill 20, row 32, scrub 72.
`stroke`: hair 1, mark 1.5, ring 2, arc 4.

`palette` (COLOR), read from the references:

| name | hex | from |
|---|---|---|
| graphite-0 | #15171A | R7 water |
| graphite-1 | #1B1D21 | R7 ground |
| graphite-2 | #23262C | R8 land |
| graphite-3 | #2A2D33 | R7 streets |
| graphite-4 | #33373F | hairline |
| graphite-5 | #444955 | strong hairline |
| graphite-6 | #8F939B | muted text, pre-blended 60% |
| graphite-7 | #E6E8EC | text |
| verdant-0 | #03201A | R4 edge |
| verdant-1 | #062A22 | R4 ground |
| verdant-2 | #0F4536 | R4 land |
| verdant-3 | #134B3C | grid |
| verdant-4 | #1C5446 | hairline |
| verdant-5 | #2A6A5A | strong hairline |
| verdant-6 | #7FA598 | muted text, pre-blended |
| verdant-7 | #E4F0EA | text |
| white | #F5F7FA | |
| cyan | #4FC3F7 | friendly (R7, R8) |
| cyan-deep | #2A9BD1 | friendly hover / arc |
| red | #FF5252 | hostile |
| red-deep | #D83A3A | hostile hover |
| green | #6EE7A0 | neutral |
| mint | #9CF5C3 | neutral on verdant |
| amber | #FFC857 | unknown / warn (R7 yellow) |
| gold | #E8C36A | score (R3) |
| magenta | #D65DB1 | sensor accent (R8) |
| ink | #0E1013 | text on cyan/amber |

### Semantic — `color`, modes `graphite` and `verdant` (graphite default)

| token | graphite | verdant | role |
|---|---|---|---|
| ground-0 | graphite-0 | verdant-0 | sea, HUD bar |
| ground-1 | graphite-1 | verdant-1 | map floor / page |
| land | graphite-2 | verdant-2 | landmass silhouette |
| grid | graphite-3 | verdant-3 | graticule, streets |
| panel | #1E2126 | #08322A | floating panel (map at 92% black, pre-blended) |
| panel-raised | #262A31 | #0E3D33 | menu, hover row |
| hairline | graphite-4 | verdant-4 | |
| hairline-strong | graphite-5 | verdant-5 | |
| text | graphite-7 | verdant-7 | |
| text-muted | graphite-6 | verdant-6 | |
| text-inverse | ink | ink | on cyan / amber fills |
| friendly | cyan | cyan | |
| friendly-deep | cyan-deep | cyan-deep | |
| hostile | red | red | |
| hostile-deep | red-deep | red-deep | |
| neutral | green | mint | |
| unknown | amber | amber | |
| warn | amber | amber | |
| info | cyan | cyan | |
| score | gold | gold | rank figures, rewards |
| accent | magenta | magenta | sensors, secondary series |
| focus | cyan | cyan | |
| selection | #2B3A45 | #0F4A46 | selected row (cyan at 20%, pre-blended) |
| mark | white | white | data marks, dots |
| mark-track | graphite-4 | verdant-4 | ring tracks, bar tracks |
| glow | #3A5560 | #1D6A62 | halo behind a marker (cyan at 25%, pre-blended) |
| on-dark | white | white | text that sits on ground-0 in both modes |

### Semantic — `layout`

screen 1440, screen-h 900, hud 44, margin 16, gap 12, panel-pad 12,
panel-gap 12, panel-header 28, panel-1 320, panel-2 400, panel-inner-1 296,
panel-inner-2 376, dock-body 296, card-body 200, rail-w 36, scrub-h 72,
scrub-w 1408, doc 1440, doc-pad 72, doc-inner 1296, map-inset-h 540.

A panel is `2·panel-pad + panel-header + panel-gap` = 64 taller than its body.
Every floating panel on the screen declares what it holds and `fits()` refuses
a body it would run out of, as in Simple.

### Component tier

`button`: primary-fill → friendly, primary-hover → friendly-deep, primary-label
→ text-inverse, ghost-border → hairline-strong, ghost-hover-fill → panel-raised,
danger-fill → hostile, danger-hover → hostile-deep, focus → focus,
disabled-fill → panel-raised.
`marker`: friendly, hostile, neutral, unknown → the four affiliations;
halo → glow; bracket → mark; label → text.
`map`: sea → ground-1, land → land, coast → hairline, graticule → grid,
range-ring → hairline-strong, compass → text-muted, scale → text.
`panel`: fill → panel, header → ground-0, border → hairline, close → text-muted.
`hud`: fill → ground-0, text → on-dark, clock → score, divider → hairline.
`pill`: filled-label → text-inverse, outline-border → hairline-strong.
`scrub`: rule → hairline-strong, tick → hairline, playhead → friendly,
event-info → info, event-warn → warn, event-critical → hostile.
`objective`: track → mark-track, fill → friendly, done → neutral, failed → hostile.
`menu`: fill → panel-raised, hover → selection, danger → hostile, shortcut → text-muted.

Rule: a token references its own tier or lower.

## Components

Tier, axes, props. Everything that is a presence or a string is a prop.

### Chrome

**HudBar** — no axes. Props `mission` (TEXT), `clock` (TEXT), `operator`
(TEXT), `alerts` (TEXT). Slot `center`. 1440 × 44, `hud#fill`. Left: a 16px
crosshair mark, the mission name in tracked caps 12px on-dark. Centre: the slot
(default: a SegmentedToggle-shaped placeholder drawn as text — the real
toggle is placed by the screen). Right: clock 14px in `score`, a hairline
divider, an alert count with a 6px `hostile` dot, the operator name 12px muted.
Appearance: R7's tab strip and R3's tiny centred nav, on R1's black bar.

**PanelHeader** — axis `action` none | close | pin | expand. Props `title`
(TEXT), `eyebrow` (TEXT), `showEyebrow` (BOOLEAN). 28 high, fills its panel.
Eyebrow 10px tracked caps muted above the title 14px medium; the action glyph
16px at the right. Appearance: R8's black header strip.

**FloatingPanel** — axis `tone` neutral | friendly | hostile. Props `title`,
`eyebrow`, `showEyebrow`. Slot `body`. `panel#fill`, radius `panel`, 1px
`panel#border`, a 2px stripe down the left edge in the tone colour (neutral:
none). Padding `panel-pad`, vertical gap `panel-gap`; first child a
PanelHeader, second the body slot. Natural width `panel-1`; the body fills.
Appearance: R7's chat panel, R8's chart panel, R5's detail card.

**EdgeRail** — no axes. Slot `items`. A vertical stack of IconButtons at
`space#xs` on a `panel#fill` surface with radius `panel` and a hairline border,
padding `xs`. Default items: layers, zoom-in, zoom-out, locate. Appearance:
R7's right rail, R5's zoom stack.

### Controls

**Button** — axes `kind` primary | ghost | danger, `interaction` default |
hover | focus | active | disabled, `size` md | sm. Prop `label`. Pill radius.
Primary: cyan fill, ink label. Ghost: hairline-strong 1px outline, text label,
hover fills panel-raised. Danger: hostile fill. Label 12px tracked caps.
md 32 high with 16 side padding; sm 24 with 12. Appearance: R3's gold outline
pill, R5's caps ghost button.

**IconButton** — axes `state` rest | selected, `interaction` default | hover |
focus | disabled. Slot `glyph` (default: layers). 36 square, radius `control`,
no fill at rest; hover panel-raised; selected: cyan glyph and a 2px cyan bar
on the left edge. Appearance: R7's rail squares.

**SegmentedToggle** — axis `selected` a | b | c. Props `a`, `b`, `c` (TEXT),
`showC` (BOOLEAN). 32 high, pill outline, the selected segment filled
panel-raised with text, others muted. A 6px dot precedes the selected label.
Appearance: R5's Kart / Liste.

**CommandInput** — axes `kind` search | command, `interaction` default |
focus | disabled. Props `value`, `placeholder`, `showValue`. 32 high, 296 wide
(panel-inner-1), panel-raised fill, hairline border, focus border cyan. Prefix
glyph: a magnifier for search, a `>` chevron for command. A `⌘K` hint at the
right in muted micro caps. Appearance: R7's search field, a game console line.

**LayerSwitch** — axes `state` on | off, `interaction` default | hover |
focus | disabled. Props `label`, `count` (TEXT), `showCount`. A row 32 high
that fills its panel: a 6px swatch dot, the label 14px, the count muted at
the right, then a 28×16 switch (cyan track on, hairline-strong off).
Appearance: R7's layers rail, R2's legend row.

**CommandMenu** — axis `tone` friendly | hostile | neutral. Props `title`,
`subtitle`. Slot `items` of **MenuItem** — axes `interaction` default | hover
| disabled, `kind` normal | danger; props `label`, `shortcut`, `showShortcut`.
Menu: panel-raised fill, radius panel, hairline border, 224 wide; header with
the entity name 14px and its type 10px caps muted, a 2px tone stripe on the
left; items 32 high, label left, shortcut right in muted micro; danger in
hostile. Default items: Track, Task, Engage (danger), Details. The menu is
what a right-click on an entity opens.

### Data

**StatusPill** — axes `tone` friendly | hostile | neutral | unknown | info |
warn, `kind` filled | outline. Prop `label`. 20 high, pill radius, 10px tracked
caps. Filled: tone fill and ink label; outline: tone 1px stroke, tone label.

**Readout** — axes `layout` stacked | inline, `tone` neutral | score. Props
`caption`, `value`, `unit`, `showUnit`. Caption 10px tracked caps muted; value
28 at 400 in text (or `score`); unit 12px muted after the value on the
baseline (inline) or under it (stacked). Appearance: R8's "+ 04" and
coordinates, R3's rank figures.

**ReadinessRing** — axes `size` sm | md | lg (32 / 64 / 96), `tone` ok |
warn | danger. Props `value` (TEXT), `caption`, `showCaption`. A 1px
`mark-track` ring, a 4px arc from 12 o'clock at a fixed 72% (a vector), value
centred (12 / 20 / 28px), caption under it (md, lg). Tone colours the arc:
friendly, warn, hostile. Appearance: R8's rings, a game HP ring.

**AlertToast** — axis `severity` info | warn | critical. Props `title`,
`body`, `time`. 320 wide, panel fill, hairline border, a 2px severity stripe
on the left, a 16px glyph, title 14px medium, body 12px muted (wraps), time
10px caps muted at the top right, a close glyph. Critical pulses in the real
app; here its stripe is 4px.

**EntityMarker** — axes `affiliation` friendly | hostile | neutral | unknown,
`selection` none | hover | selected. Props `label` (TEXT, "04"), `showLabel`.
Drawn on a 48 × 32 canvas so every variant is the same size: the symbol is
centred at (16, 16), the label sits to the right. Shape by affiliation, after
APP-6: friendly a circle, hostile a diamond, neutral a square, unknown a
rounded square with clipped corners; each a 2px ring 12 across with a 6px
dot inside, in the affiliation colour. Hover adds a `glow` disc 20 across
behind the ring. Selected adds a dashed halo — drawn as eight 2px dashes on a
circle 32 across, since strokes cannot dash — and four 4px bracket corners at
the 32 box, in `mark`. Label: 20px at 400 in text, 8 from the ring.
Appearance: R8's rings and numerals, R7's square pins.

**EntityCard** — axis `affiliation` (4). Props `name`, `type`, `coords`,
`readiness`. 320 wide, a FloatingPanel-shaped surface (built from tokens, not
an instance, so it can carry the marker in its header): header row with an
EntityMarker (selection none, showLabel false), the name 16px medium, a
StatusPill of the affiliation; a rule; a row of two Readouts (COORDS mono
caption, HEADING) and a ReadinessRing sm; a rule; an actions row of two
Buttons — Track (ghost, sm) and Task (primary, sm). Instances EntityMarker,
StatusPill, Readout, ReadinessRing, Button. Appearance: R5's detail card,
R8's hero label.

**ObjectiveRow** — axis `outcome` pending | active | done | failed. Props
`title`, `progress` (TEXT, "3/5"), `reward` (TEXT, "+120"), `showReward`.
A row that fills its panel, 48 high: a 16px state glyph (circle outline /
half-filled / check in neutral / cross in hostile), the title 14px, the
progress fraction muted at the right, the reward in `score` 12px; under the
title a 3px track with the fill at the fraction. Done strikes nothing; it
dims to muted. Appearance: a quest log, R8's chart track.

**RankRow** — axis `tone` neutral | top. Props `rank` ("01"), `name`, `score`
("1,187,906"), `delta` ("+12"), `showDelta`. Fills its panel, 40 high: rank
10px caps in score (top) or muted, name 14px, score 16px at 400 right-aligned,
delta 10px in neutral. Appearance: R3's city rail.

**TimelineScrubber** — axis `state` live | paused. Props `start`, `end`,
`now` (TEXT labels). Built at `scrub-w` 1408 × `scrub-h` 72, panel fill,
radius panel, hairline border: a play/pause glyph 16px at the left; a 1px
rule with 24 ticks 4 high; five labels in micro caps under it; event dots 6px
on the rule in info / warn / hostile; a 2px cyan playhead 24 high with the
`now` label in 10px caps above it; a LIVE pill (StatusPill info filled) at the
right when live, PAUSED outline when paused. Instances StatusPill.
Appearance: R2's timeline, R3's histogram playhead.

**TacticalMap** — axis `size` stage | inset. Prop `region` (TEXT, a caption
of the area shown). Slots `entities` (EntityMarker instances) and
`overlay` (default: a range ring around the selected entity). Stage is
1440 × 900 — the screen's floor; inset is 1296 × 540, the doc page's
specimen. `map#sea` ground, land as flat `map#land` silhouettes with a 1px
`map#coast` edge, a 1° graticule in `map#graticule`, three 1px `range-ring`
circles around the selected entity, a compass rose 32 across at the top right
inside the margin, a scale bar and a coordinates Readout at the bottom left.
The land is generated from Natural Earth (world-atlas `land-50m.json` via
jsdelivr, cached under `build/data/`), projected with a plain equirectangular
projection onto the region — the Baltic Sea and Scandinavia, about 4°E–32°E
and 53°N–66°N — because its islands and fjords give a silhouette the eye
reads as a coast at a glance. The geometry is written by
`build/lib/coast.mjs`, which the map descriptor calls; no coordinates are
typed by hand. Appearance: R4's flat silhouette on R7's charcoal; the
principle that land is one step from sea and nothing else is drawn.

### Screen

**ops.uidx** — 1440 × 900, instances only. A TacticalMap at stage size is the
floor. Over it: a HudBar at the top with a SegmentedToggle (Map / List /
Timeline) in its centre slot. Left dock at `margin` under the bar: a
FloatingPanel "Objectives" (four ObjectiveRows: done, active, active,
pending) and, below it at `gap`, a FloatingPanel "Ranking" (five RankRows,
the first `top`). Right edge: an EdgeRail. Top right under the bar: an
AlertToast (critical). On the map: eleven EntityMarkers with numerals — six
friendly, three hostile, one neutral, one unknown, one of the friendly ones
selected with the range rings around it and an EntityCard floating 16 to
its right; a CommandMenu open beside a hostile marker. Bottom: a
TimelineScrubber across the width inside the margin; above its left end, a
CommandInput (command kind); at its right end, a row of three inline
Readouts (LAT/LON, HDG, SCALE). Every dock panel declares `holds` and is
checked by `fits()`. A second frame below the first, identical, under
`modes={{ color: 'verdant' }}`, is the proof of the second mode.

## Build

`design-systems/vantage/build/` is forked from Simple's: `lib/n.mjs` with
Vantage's handles, `lib/geometry.mjs` with the `layout` numbers as `G`/`L` and
every drawn height in `H`, `lib/doc-page.mjs`, `lib/spec.mjs`,
`lib/hierarchy.mjs`, `lib/icons.mjs` (the glyph set: crosshair, layers,
zoom-in, zoom-out, locate, filter, close, pin, expand, check, cross, alert,
play, pause, search, chevron-right, chevron-down, compass), `run.mjs`,
`all.mjs` (the order below), `check.mjs`, `measure.mjs`, `inspect.mjs`,
`ops.mjs` and `test/`.

Build order (leaves first):

    status-pill, readout, readiness-ring, alert-toast, objective-row, rank-row
    hud-bar, panel-header, floating-panel
    button, icon-button, segmented-toggle, command-input, layer-switch, command-menu
    entity-marker, tactical-map
    edge-rail (IconButton), timeline-scrubber (StatusPill)
    entity-card (EntityMarker, StatusPill, Readout, ReadinessRing, Button)
    measure --check
    ops

Waves for parallel agents: wave 0 foundation (tokens, build lib, README,
StatusPill as the pipeline proof); wave 1 in parallel — chrome (HudBar,
PanelHeader, FloatingPanel), controls (Button, IconButton, SegmentedToggle,
CommandInput, LayerSwitch, CommandMenu), data (Readout, ReadinessRing,
AlertToast, ObjectiveRow, RankRow), map (EntityMarker, TacticalMap); wave 2 in
parallel — EdgeRail + TimelineScrubber, EntityCard; wave 3 the screen; then a
`design-system-review` pass.

Shared files (`geometry.mjs` `H`, `measure.mjs` `SPECS`) carry one marked line
per component from the foundation build, and a component's agent edits only
its own line. `tokens.uidx`, `n.mjs` and `all.mjs` are written once by the
foundation build and read-only afterwards; a token a component turns out to
need is reported, not added.

## Verification

As the playbook: `uidx audit`, `measure --check`, `inspect`, the tests, then a
1× render of the screen and three pages, and a clearance scan of every panel.
The screen is compared against R7 and R8 side by side. Contrast is stated on
each page with its number; text-muted on panel is expected to pass 4.5:1 in
graphite and to be checked in verdant.
