import { parseOrThrow, type JsonValue, type SceneElement } from '@uidx/format'

import { isIdentityProp, mappingFor } from './prop-table.js'
import { PROP_UI } from './prop-ui.js'
import { toSceneGraph } from './to-scene.js'

/**
 * What the engine falls back to for a property nobody set (story C7).
 *
 * An unset row in the inspector shows the value the file currently resolves
 * to, dimmed. That number has to be the engine's own answer — a hand-written
 * table would drift the moment the SDK changed a default, and a dimmed row
 * showing the wrong value is worse than no row at all: it states, in the
 * panel, something the document does not mean.
 *
 * So the defaults are measured rather than declared. One bare node of each
 * element is built through `toSceneGraph` and read back through the very
 * `fromScene` mappings the write path uses, which makes the shown value the
 * same value a write would have to change.
 */

/**
 * A minimal document per element, with nothing set beyond what the parser
 * demands.
 *
 * `Variant` is deliberately absent, and the type says so rather than the table
 * carrying a fixture nobody probes: a `<Variant>` has no geometry of its own at
 * all (ADR 0005 §5, and D4's predicate that follows from it), so there is no
 * unset row for the inspector to show dimmed. Excluding it by type keeps the
 * exhaustiveness that makes this table honest for every element that *does*
 * have one.
 */
const BARE: Record<Exclude<SceneElement, 'Variant'>, string> = {
  Page: '<Page />',
  Component: '<Component name="probe" status="draft"><Frame name="child" /></Component>',
  Frame: '<Frame name="probe" />',
  Text: '<Text name="probe" characters="probe" />',
  Rectangle: '<Rectangle name="probe" />',
  Ellipse: '<Ellipse name="probe" />',
  Vector: '<Vector name="probe" />',
  // Story F3. Probed with a name that resolves to nothing, deliberately: what
  // is being measured is the engine's own answer for an INSTANCE node, which is
  // what an instance falls back to when neither the use nor the definition says
  // anything. An instance whose component *does* resolve inherits that
  // component's values instead, and showing those as the dimmed fallback is
  // F7's problem — it is the story that gives an instance a panel of its own.
  Instance: '<Instance name="probe" component="probe" />',
  // Story F5. A slot is only legal inside a component, never on a page and
  // never as a component's direct child (ADR 0007 §1), so its probe carries
  // the frame that makes the position legal. What comes back is a `FRAME`'s
  // defaults, which is what a slot is — and the declaration side is the only
  // side with unset rows to show, since a fill carries `name` alone.
  Slot: '<Component name="probe-slot" status="draft"><Frame name="p"><Slot name="probe" /></Frame></Component>',
}

/**
 * The few props the engine leaves empty on a bare node, because they only
 * mean anything once something else is set — `strokeAlign` says nothing until
 * there is a stroke to align. Figma still shows a value there, so these are
 * declared; the test below holds the list to exactly the props the probe
 * finds nothing for, so it cannot quietly grow into a hand-written table.
 */
const ENGINE_SILENT: Record<string, JsonValue> = {
  strokeAlign: 'INSIDE',
  // The pin offsets, which the engine cannot answer for at all: they have no
  // scene field (ADR 0011 §2). Zero is not a guess — it is the rule the
  // resolver already applies, so a MAX-pinned child stating no `right` sits
  // flush against the far edge. Showing "–" here would say the row has no
  // value, when what it has is a value the file did not need to write.
  right: 0,
  bottom: 0,
  centerX: 0,
  centerY: 0,
}

/** Element -> prop -> resolved value, built once on first use. */
let table: Map<string, Map<string, JsonValue>> | null = null

function probe(element: Exclude<SceneElement, 'Variant'>): Map<string, JsonValue> {
  const values = new Map<string, JsonValue>()
  const body = BARE[element]
  const wrapped = element === 'Page' || element === 'Component' ? body : `<Page>${body}</Page>`
  const doc = parseOrThrow(`---\nid: defaults\n---\n\n## Visual Contract\n\n${wrapped}\n`)
  const scene = toSceneGraph(doc)

  // The probed node is the deepest one the fixture declares that is this element.
  let found: { id: string } | undefined
  const walk = (node: { element: string; address: string; children: readonly unknown[] }): void => {
    if (node.element === element && !found) {
      const id = scene.addresses.sceneIdOf(node.address)
      if (id) found = { id }
    }
    for (const child of node.children) {
      walk(child as { element: string; address: string; children: readonly unknown[] })
    }
  }
  walk(doc.tree as never)
  const sceneNode = found ? scene.graph.getNode(found.id) : undefined
  if (!sceneNode) return values

  for (const name of Object.keys(PROP_UI)) {
    const mapping = mappingFor(name)
    const value = mapping
      ? mapping.fromScene(sceneNode)
      : isIdentityProp(name)
        ? ((sceneNode as unknown as Record<string, unknown>)[name] as JsonValue | undefined)
        : undefined
    if (value !== undefined) values.set(name, value)
  }
  return values
}

function ensure(): Map<string, Map<string, JsonValue>> {
  if (table) return table
  table = new Map()
  for (const element of Object.keys(BARE) as Exclude<SceneElement, 'Variant'>[]) {
    table.set(element, probe(element))
  }
  return table
}

/**
 * The value `element` resolves `prop` to when the file does not say.
 * Undefined when the prop does not apply, or the engine offers nothing.
 */
export function defaultFor(element: SceneElement, prop: string): JsonValue | undefined {
  const ui = PROP_UI[prop]
  if (!ui) return undefined
  if (ui.appliesTo && !ui.appliesTo.includes(element)) return undefined
  return ensure().get(element)?.get(prop) ?? ENGINE_SILENT[prop]
}

/** The props `ENGINE_SILENT` covers, for the drift test that keeps it honest. */
export const DECLARED_DEFAULTS: readonly string[] = Object.keys(ENGINE_SILENT)

/** Whether the engine itself answered for this element and prop. */
export function engineAnswers(element: SceneElement, prop: string): boolean {
  return ensure().get(element)?.has(prop) === true
}
