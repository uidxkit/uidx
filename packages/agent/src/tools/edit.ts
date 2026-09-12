import { tool, type Tool } from 'ai'
import { z } from 'zod'

import { tooEarly, type WriteGate } from '../agent/gate.js'
import { applyOps, createFile, deleteFile, setIntent, type ApplyContext } from '../edit/apply.js'
import { badAliasNotice } from '../edit/alias-types.js'
import { drawsNothingNotice } from '../edit/draws-nothing.js'
import { missingGlyphsNotice } from '../edit/missing-glyphs.js'
import { overflowNotice } from '../edit/overflow.js'
import { overlapNotice } from '../edit/overlaps.js'
import { fixedWithoutSizeNotice } from '../edit/sizing.js'
import { editOpsSchema, narrowOps, type EditOp, type NodeInput } from '../edit/ops.js'
import { METADATA_ATTRS, TOKEN_ELEMENTS } from '@uidx/format'
import { KNOWN_PROPS, PIN_PROPS, STRUCTURAL_PROPS } from '@uidx/schema'

import type { DocumentIndex } from '../index/types.js'

export interface EditDeps extends ApplyContext {
  maxFilesPerTurn: number
  onFileTouched?: (file: string) => void
  /** A budget shared with other writing tools (`eval`); absent, this module makes its own. */
  fileBudget?: TurnFileBudget
  /**
   * The document's index, when this tool runs inside a real turn. It is what
   * lets an `Instance` naming a component nobody defined come back with the
   * names that do exist — the map already knows them, and rebuilding a
   * component that already exists is the failure this refusal aims at. Absent
   * outside a turn, where there is nothing to check against.
   */
  index?: DocumentIndex
  /**
   * Closed until the orchestrator has taken a step, so these three refuse an
   * early call instead of vanishing from the tool set. Omit it and they never
   * refuse on those grounds. See `gate.ts`.
   */
  writeGate?: WriteGate
}

/**
 * Fixed opening of every refusal these three tools can return. Exported so a
 * reader elsewhere — `delegate.ts`'s worker-refusal detector — can recognise
 * one without re-typing the literal text: the same "author it once, import
 * it at the read site" shape `agent.ts` already uses for `SUMMARY_HEADER`,
 * so the two can never drift silently out of sync.
 */
export const NOT_APPLIED_PREFIX = 'not applied — '
export const NOT_WRITTEN_PREFIX = 'not written — '
export const NOT_CREATED_PREFIX = 'not created — '
export const NOT_DELETED_PREFIX = 'not deleted — '
/** The fixed opening only — the rest names the actual limit and varies with `deps.maxFilesPerTurn`. */
export const FILE_BUDGET_REACHED_PREFIX = 'file budget reached'

/**
 * Every prop a scene node may carry, from the schema package's own vocabulary
 * rather than a list restated here.
 *
 * `name` is the authored identity, `variants` and `status` are a Component's,
 * and `id` appears on a page root — none live in `KNOWN_PROPS`, which is about
 * what reaches the *scene*.
 */
const ALLOWED_PROPS = new Set<string>([
  ...KNOWN_PROPS,
  ...STRUCTURAL_PROPS,
  ...PIN_PROPS,
  ...METADATA_ATTRS,
  // The authored identity and a page's frontmatter id, neither of which is a
  // scene property and so neither of which is in `KNOWN_PROPS`.
  'name',
  'id',
])

/**
 * Elements whose props this must not judge.
 *
 * The same two carve-outs `uidx check`'s own unknown-prop lint makes, taken
 * from the same sets rather than restated — arrived at here independently and
 * then reconciled, which is how they came to be shared.
 *
 * A `<Variant>`'s props are its component's axis names — `state`, `size`,
 * anything the author declared — so there is no fixed set to check against.
 * The token tree has a vocabulary of its own (`type`, `value` on a Variable,
 * `tier` on a Collection, all of which appear in this repo's own files), and
 * `KNOWN_PROPS` does not describe it.
 *
 * Both exemptions were found by running this rule over every `.uidx` in
 * `examples/` and `design/` before it shipped: without them it rejected real,
 * correct pages, which is far worse than the hole it closes.
 */
const UNCHECKED_ELEMENTS = new Set<string>(['Variant', ...TOKEN_ELEMENTS])

/** As many prop names as a refusal lists when suggesting alternatives. */
const MAX_SUGGESTIONS = 3

/**
 * What a model reaches for instead of the real prop, and what it meant.
 *
 * Every entry is a mistake actually seen on the wire rather than a guess: a
 * `Text` node's words were written as `copy` by qwen3.5 and probed as `body`
 * by Sonnet, and `label` is what both reach for when a component declares a
 * prop by that name. Prefix matching cannot bridge any of these — nothing
 * takes you from `cop` to `characters` — so the near misses that matter are
 * named, and spelling slips fall through to the prefix rule below.
 */
const MEANT: Record<string, string> = {
  copy: 'characters',
  text: 'characters',
  content: 'characters',
  label: 'characters',
  title: 'characters',
  body: 'characters',
  intent: 'characters',
  coreintent: 'characters',
  color: 'fills',
  background: 'fills',
  radius: 'cornerRadius',
  padding: 'paddingTop, paddingRight, paddingBottom, paddingLeft',
  gap: 'itemSpacing',
  direction: 'layoutMode',
}

/**
 * The values an enum prop may take — the ones a model actually writes, from
 * the authoring skill's own documentation of them.
 *
 * Exists because of one lowercase letter. A run wrote `layoutMode="vertical"`,
 * and everything downstream shrugged: the prop *name* is known so no refusal
 * fired, the engine ignored the value it didn't recognise so no auto-layout
 * happened, the children collapsed into a 56px sliver — and the overlap audit
 * was blinded too, because it took "has a layoutMode" to mean "places its
 * children". Valid name, invalid value, page ruined, zero errors: the same
 * family as an unknown prop, caught the same way.
 */
const ENUM_PROPS: Record<string, readonly string[]> = {
  layoutMode: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
  primaryAxisSizingMode: ['FIXED', 'AUTO'],
  counterAxisSizingMode: ['FIXED', 'AUTO'],
  primaryAxisAlignItems: ['MIN', 'CENTER', 'MAX', 'SPACE_BETWEEN'],
  counterAxisAlignItems: ['MIN', 'CENTER', 'MAX', 'STRETCH', 'BASELINE'],
  textAutoResize: ['NONE', 'WIDTH_AND_HEIGHT', 'HEIGHT', 'TRUNCATE'],
  strokeAlign: ['INSIDE', 'OUTSIDE', 'CENTER'],
}

/**
 * Refuses an enum value nothing accepts, naming the case-insensitive match
 * when there is one — `"vertical"` is a slip of the shift key, not a mystery.
 */
function badEnumValue(prop: string, value: unknown): string | null {
  const allowed = ENUM_PROPS[prop]
  if (!allowed || typeof value !== 'string' || allowed.includes(value)) return null
  const meant = allowed.find((option) => option.toLowerCase() === value.toLowerCase())
  const hint = meant
    ? ` — did you mean ${JSON.stringify(meant)}?`
    : ` — it takes ${allowed.join(', ')}`
  return `${JSON.stringify(value)} is not a ${prop}${hint}`
}

/** The closest allowed prop names to what was written, for a did-you-mean. */
function nearest(prop: string): string[] {
  const lower = prop.toLowerCase()
  const meant = MEANT[lower]
  if (meant) return [meant]
  return [...ALLOWED_PROPS]
    .filter(
      (known) =>
        known.toLowerCase().startsWith(lower.slice(0, 3)) ||
        lower.startsWith(known.toLowerCase().slice(0, 3)),
    )
    .slice(0, MAX_SUGGESTIONS)
}

/**
 * Whether an element may carry a prop. Exported so the rule can be checked
 * against every page this repo ships without going through a write.
 *
 * Stricter here than `uidx check`, deliberately. Spec §3.3 makes an unknown
 * prop a *warning* — the format is allowed to lead the tool, so a human
 * authoring a property the schema has not caught up with should not be
 * blocked. A model writing one is not doing that; every instance measured was
 * a mistake, and the cost is a page that parses, validates, renders blank and
 * reports zero errors. A warning it can ignore is not enough for that.
 *
 * The hole this closes was caught red-handed: asked for prose sections it had
 * no tool to write, Claude Sonnet probed for a way in with
 * `<Page coreIntent="test-value-check" intent="TEST-INTENT-CHANGE">` — and the
 * harness answered "applied" three times, because an unknown prop parsed
 * happily and reached the scene as nothing. The page stayed valid, rendered
 * blank, and reported zero errors.
 */
export function isAllowedProp(element: string, prop: string): boolean {
  return UNCHECKED_ELEMENTS.has(element) || ALLOWED_PROPS.has(prop)
}

/**
 * Refuses a prop no uidx element carries, naming the near misses.
 *
 * Stricter here than `uidx check`, deliberately. Spec §3.3 makes an unknown
 * prop a *warning* — the format is allowed to lead the tool, so a human
 * authoring a property the schema has not caught up with should not be
 * blocked. A model writing one is not doing that; every instance measured was
 * a mistake, and the cost is a page that parses, validates, renders blank and
 * reports zero errors. A warning it can ignore is not enough for that.
 *
 * The hole this closes was caught red-handed: asked for prose sections it had
 * no tool to write, Claude Sonnet probed for a way in with
 * `<Page coreIntent="test-value-check" intent="TEST-INTENT-CHANGE">` — and the
 * harness answered "applied" three times, because an unknown prop parsed
 * happily and reached the scene as nothing. The page stayed valid, rendered
 * blank, and reported zero errors.
 */
/**
 * Every reason to refuse a batch of ops before it touches a file, in one
 * place — the prop-name and enum-value gates, and the instance-of-nothing
 * check when an index is present. Exported for the core facade: the CLI, the
 * MCP server and eval scripts must refuse exactly what the harness's own edit
 * tool refuses, and for a while they did not — a surface that skipped these
 * would happily write layoutMode="vertical" and bring back a closed failure
 * class.
 */
export function refuseBadOps(ops: readonly EditOp[], index?: DocumentIndex): string | null {
  return unknownProp(ops) ?? unknownComponent(index, ops)
}

function unknownProp(ops: readonly EditOp[]): string | null {
  const check = (element: string, prop: string, value: unknown, where: string): string | null => {
    if (!isAllowedProp(element, prop)) {
      const near = nearest(prop)
      const hint = near.length > 0 ? ` — did you mean ${near.join(', ')}?` : ''
      return `${where} sets ${JSON.stringify(prop)}, which is not a uidx prop${hint}`
    }
    // A known prop can still carry a value nothing accepts, and the engine
    // ignores what it does not recognise — same silent failure, same refusal.
    const badValue = badEnumValue(prop, value)
    return badValue ? `${where} sets ${prop}=${badValue}` : null
  }

  for (const [i, op] of ops.entries()) {
    const at = `op ${i + 1}`
    if (op.kind === 'set_prop') {
      // `set_prop` names no element, so the strictest reading applies: a prop
      // nothing carries is wrong wherever it lands.
      const refusal = check('', op.prop, op.value, at)
      if (refusal) return refusal
    }
    if (op.kind === 'insert_node') {
      const walk = (node: NodeInput, path: string): string | null => {
        for (const [prop, value] of Object.entries(node.attrs ?? {})) {
          const refusal = check(node.element, prop, value, `${at}'s ${path}`)
          if (refusal) return refusal
        }
        for (const child of node.children ?? []) {
          const refusal = walk(child, `${path} > ${child.element}`)
          if (refusal) return refusal
        }
        return null
      }
      const refusal = walk(op.node, op.node.element)
      if (refusal) return refusal
    }
  }
  return null
}

/** As many component names as a refusal lists before it starts counting. */
const MAX_NAMED_COMPONENTS = 8

/**
 * Refuses an op that instances a component no page defines, naming the ones
 * that do. Null when every referenced component is real, or when there is no
 * index to check against.
 */
function unknownComponent(index: DocumentIndex | undefined, ops: readonly EditOp[]): string | null {
  if (!index) return null
  // A batch may define a component and instance it in the same breath — one
  // eval script composing a Component and its states grid together is the
  // ordinary case, not an edge — so what the batch itself defines counts as
  // known. Caught by exactly that script being wrongly refused.
  const definedInBatch = new Set<string>()
  for (const op of ops) {
    if (op.kind !== 'insert_node') continue
    const walk = (node: NodeInput): void => {
      const name = node.attrs?.name
      if (node.element === 'Component' && typeof name === 'string') definedInBatch.add(name)
      for (const child of node.children ?? []) walk(child)
    }
    walk(op.node)
  }
  for (const [i, op] of ops.entries()) {
    if (op.kind !== 'insert_node') continue
    const wanted = new Set<string>()
    const walk = (node: NodeInput): void => {
      const component = node.attrs?.component
      if (typeof component === 'string') wanted.add(component)
      for (const child of node.children ?? []) walk(child)
    }
    walk(op.node)
    for (const name of wanted) {
      if (definedInBatch.has(name)) continue
      if (index.components.has(name)) continue
      const all = [...index.components.keys()].sort()
      const named = all.slice(0, MAX_NAMED_COMPONENTS)
      const rest = all.length - named.length
      const more = rest > 0 ? `, (+${rest} more)` : ''
      const has =
        all.length === 0
          ? 'the document defines none'
          : `the document has ${named.join(', ')}${more}`
      return `op ${i + 1} instances ${JSON.stringify(name)}, which no page defines — ${has}`
    }
  }
  return null
}

/**
 * The turn's file budget, shared: `edit`/`create_file`/`set_intent` and the
 * `eval` tool all spend from one allowance — a script writing three files is
 * three files touched, exactly as three edit calls would be.
 */
export interface TurnFileBudget {
  check(file: string): string | null
  record(file: string): void
}

export function createFileBudget(
  maxFilesPerTurn: number,
  onFileTouched?: (file: string) => void,
): TurnFileBudget {
  const touched = new Set<string>()
  return {
    check: (file) =>
      touched.has(file) || touched.size < maxFilesPerTurn
        ? null
        : `${FILE_BUDGET_REACHED_PREFIX} (${maxFilesPerTurn} files this turn) — finish and report instead`,
    record: (file) => {
      if (!touched.has(file)) {
        touched.add(file)
        onFileTouched?.(file)
      }
    },
  }
}

export function editTools(deps: EditDeps): {
  edit: Tool
  create_file: Tool
  delete_file: Tool
  set_intent: Tool
} {
  const shared = deps.fileBudget ?? createFileBudget(deps.maxFilesPerTurn, deps.onFileTouched)
  const budgetLeft = (file: string): string | null => shared.check(file)
  const record = (file: string): void => shared.record(file)

  const edit = tool({
    description:
      'Change one page. Reuse an existing component before building a new tree; extract a repeated structure into a Component.',
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      ops: editOpsSchema,
    }),
    execute: async ({ file, ops }) => {
      const early = tooEarly(deps.writeGate, 'edit')
      if (early) return `${NOT_APPLIED_PREFIX}${early}`
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      // The schema above is flat by design (see `ops.ts`), so which fields a
      // kind actually needs is checked here rather than by zod. A mismatch
      // takes the same route a refused edit does: text the model can act on.
      const narrowed = narrowOps(ops)
      if (!narrowed.ok) return `${NOT_APPLIED_PREFIX}${narrowed.message}`
      const badProp = unknownProp(narrowed.value)
      if (badProp) return `${NOT_APPLIED_PREFIX}${badProp}`
      const unknown = unknownComponent(deps.index, narrowed.value)
      if (unknown) return `${NOT_APPLIED_PREFIX}${unknown}`
      const result = await applyOps(deps, file, narrowed.value)
      if (!result.ok) return `${NOT_APPLIED_PREFIX}${result.error}`
      // A batch that nets no textual delta never reaches a checkpoint or a
      // write (see apply.ts) — there is nothing to revert, so it must not
      // draw against the same budget a real write does.
      if (result.changed > 0) record(file)
      // Computed, not looked at. A frame with no size and no fill is valid
      // uidx that renders blank, and the model would otherwise only find out
      // by calling view_image — which across six turns of a real run it never
      // did once. Nor would a picture help with the third of these: a section
      // 144px wider than its parent is a few soft pixels at half scale, and
      // twelve of them made a page unreadable while every other audit passed.
      // The write happened either way, so a page the index has not caught up
      // with yet costs the audit, never the edit.
      const written = deps.workspace.docOf(file)
      const audit = written
        ? `${drawsNothingNotice(written)}${overlapNotice(written)}${overflowNotice(written)}` +
          `${fixedWithoutSizeNotice(written)}${badAliasNotice([...deps.workspace.docs().values()], written)}` +
          (await missingGlyphsNotice(written))
        : ''
      return `applied ${result.changed} change(s) to ${file}${audit}`
    },
  })

  const create_file = tool({
    description: 'Create a new empty page, then fill it with edit.',
    inputSchema: z.object({
      file: z.string().describe('new page path, e.g. settings.uidx'),
      pageId: z.string().describe('the id in the page frontmatter'),
    }),
    execute: async ({ file, pageId }) => {
      const early = tooEarly(deps.writeGate, 'create_file')
      if (early) return `${NOT_CREATED_PREFIX}${early}`
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await createFile(deps, file, pageId)
      if (!result.ok) return `${NOT_CREATED_PREFIX}${result.error}`
      record(file)
      return `created ${file}`
    },
  })

  const delete_file = tool({
    description: 'Delete a page. Only when the user asked for it.',
    inputSchema: z.object({ file: z.string() }),
    execute: async ({ file }) => {
      const early = tooEarly(deps.writeGate, 'delete_file')
      if (early) return `${NOT_DELETED_PREFIX}${early}`
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await deleteFile(deps, file)
      if (!result.ok) return `${NOT_DELETED_PREFIX}${result.error}`
      record(file)
      return `deleted ${file}`
    },
  })

  const set_intent = tool({
    description:
      "Write a page's Markdown intent — the prose above the tree, where sections like ## Core Intent and ## Anti-Patterns live. Replaces all of it, so include every section you want kept.",
    inputSchema: z.object({
      file: z.string().describe('page path, e.g. home.uidx'),
      body: z
        .string()
        .describe('the whole intent as Markdown, "## Heading" sections and their paragraphs'),
    }),
    execute: async ({ file, body }) => {
      const early = tooEarly(deps.writeGate, 'set_intent')
      if (early) return `${NOT_WRITTEN_PREFIX}${early}`
      const blocked = budgetLeft(file)
      if (blocked) return blocked
      const result = await setIntent(deps, file, body)
      if (!result.ok) return `${NOT_WRITTEN_PREFIX}${result.error}`
      if (result.changed > 0) record(file)
      return `wrote the intent of ${file}`
    },
  })

  return { edit, create_file, delete_file, set_intent }
}
