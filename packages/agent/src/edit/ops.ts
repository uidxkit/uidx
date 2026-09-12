import { ELEMENTS, TOKEN_ELEMENTS } from '@uidx/format'
import { z } from 'zod'

/**
 * What `insert_node` may build, derived from the parser's own whitelist rather
 * than restated — `Page` because a page cannot contain another page, and the
 * token elements because they belong to a token file's tree, not a scene.
 *
 * An enum rather than a described string, and the reason is measured. As a
 * free `z.string()` carrying the allowed values in its *description*, qwen3.5
 * spent eleven consecutive attempts theorising about what `element` meant —
 * a path identifier, an object with a nested `type`, a token alias — and never
 * once wrote `"Text"`. The values have to be in the schema as data, where a
 * model reads them, not in prose it has to interpret. Which element is legal
 * in which position is still the parser's call; this only bounds the
 * vocabulary so there is nothing left to invent.
 */
const INSERTABLE_ELEMENTS = ELEMENTS.filter(
  (element) => element !== 'Page' && !TOKEN_ELEMENTS.has(element),
) as [string, ...string[]]

/**
 * Small models are unreliable at free-text markup, so the edit surface is a
 * closed set of intents with flat arguments. The harness does the surgery.
 */
const jsonValue: z.ZodType<string | number | boolean | null | unknown[] | Record<string, unknown>> =
  z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValue),
      z.record(z.string(), jsonValue),
    ]),
  )

/**
 * A node the way the markup writes one: a tag, and its props beside it.
 *
 * `attrs` is still accepted, but nothing in a `.uidx` file looks like that —
 * a node there is `<Text name="title" characters="Hello" />`, props flat on
 * the tag — and a model that has spent the whole turn reading those files
 * writes what it read. Measured: given the enum it corrected `type` to
 * `element` in one step, then dropped `characters="Hello"` on the floor
 * rather than discovering it belonged in a nested `attrs`. Accepting both and
 * folding them together costs one merge; refusing the natural shape costs the
 * content.
 */
const nodeInput: z.ZodType<NodeInputRaw> = z.lazy(() =>
  z
    .object({
      element: z.enum(INSERTABLE_ELEMENTS).describe("the node's tag"),
      name: z.string().optional().describe('omit to have one generated'),
      children: z.array(nodeInput).optional(),
      attrs: z
        .record(z.string(), jsonValue)
        .optional()
        .describe('optional: props may also go here rather than beside the tag'),
    })
    .catchall(jsonValue)
    .describe('props go beside the tag, e.g. { "element": "Text", "characters": "Hello" }'),
)

/** What the schema accepts: the four known fields, plus any prop written beside the tag. */
export type NodeInputRaw = {
  element: string
  name?: string
  attrs?: Record<string, unknown>
  children?: NodeInputRaw[]
} & { [prop: string]: unknown }

/** What `compileOps` builds from — props gathered into one place. */
export interface NodeInput {
  element: string
  name?: string
  attrs?: Record<string, unknown>
  children?: NodeInput[]
}

/**
 * Gathers props written beside the tag into `attrs`, recursively. An explicit
 * `attrs` wins a collision: it is the unambiguous way to say "this is a prop",
 * so a model that used both meant that one.
 */
export function foldAttrs(node: NodeInputRaw): NodeInput {
  const { element, name, attrs, children, ...beside } = node
  const merged = { ...beside, ...(attrs ?? {}) }
  return {
    element,
    ...(name === undefined ? {} : { name }),
    ...(Object.keys(merged).length > 0 ? { attrs: merged } : {}),
    ...(children === undefined ? {} : { children: children.map(foldAttrs) }),
  }
}

/**
 * Every address field says the same thing, in the same words.
 *
 * These are prompt tokens for a small model, and a schema that explains the
 * syntax on one field and leaves five bare invites the model to guess that the
 * bare ones mean something else. Terse and identical is the point.
 */
const ADDRESS = 'node address, e.g. hero#headline; "#" bounds an entity, "/" walks deeper'
/**
 * The one variation: a parent may also be the page itself. Written with a
 * visible token beside the empty one, because `""` on its own is a shape a
 * model reads straight past — see `PAGE_ROOT_ALIASES`.
 */
const PARENT = `${ADDRESS}; use "/" or "" for the page root itself`

/**
 * What an op *is*, once it has been checked — six shapes, each with exactly
 * the fields its kind uses. Everything downstream (`compileOps`, `applyOps`)
 * takes this, and nothing downstream changed when the model-facing schema
 * below stopped matching it.
 */
export type EditOp =
  | { kind: 'set_prop'; address: string; prop: string; value: JsonInput }
  | { kind: 'remove_prop'; address: string; prop: string }
  | { kind: 'insert_node'; parent: string; index?: number; node: NodeInput }
  | { kind: 'remove_node'; address: string }
  | { kind: 'move_node'; address: string; newParent: string; index: number }
  | { kind: 'rename'; address: string; name: string }

export type JsonInput = z.infer<typeof jsonValue>

export const EDIT_OP_KINDS = [
  'set_prop',
  'remove_prop',
  'insert_node',
  'remove_node',
  'move_node',
  'rename',
] as const

/**
 * One flat object with every field on it, not the six-way union `EditOp`
 * describes.
 *
 * A discriminated union serializes to a top-level `oneOf` with no `properties`
 * at the root, and a small model cannot read that: measured on qwen3.5:9b
 * against an identical request, the union form produced a call with the
 * discriminator missing and an array stringified, and never converged across
 * seven attempts even though the SDK hands back a validation error naming the
 * exact missing field. The same request against a flat schema was correct
 * first try. `delegate` — the one write-path tool this model has always called
 * correctly — was flat all along.
 *
 * The cost is that "which fields go with which kind" stops being a compile-time
 * guarantee at this boundary and becomes `narrowOps`'s job, which is why that
 * function answers in the same teaching voice as a refused edit rather than
 * throwing.
 */
const editOpInputSchema = z.object({
  kind: z.enum(EDIT_OP_KINDS),
  address: z
    .string()
    .optional()
    .describe(`set_prop/remove_prop/remove_node/move_node/rename: ${ADDRESS}`),
  prop: z.string().optional().describe('set_prop/remove_prop: the property name'),
  value: jsonValue.optional().describe('set_prop: the new value'),
  parent: z.string().optional().describe(`insert_node: ${PARENT}`),
  node: nodeInput.optional().describe('insert_node: the node to build'),
  newParent: z.string().optional().describe(`move_node: ${PARENT}`),
  index: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('insert_node: omit to append. move_node: required, the position to move to'),
  name: z.string().optional().describe('rename: the new name'),
})

export const editOpsSchema = z.array(editOpInputSchema).min(1)

export type EditOpInput = z.infer<typeof editOpInputSchema>

export type NarrowResult<T> = { ok: true; value: T } | { ok: false; message: string }

/**
 * Ways of writing "the page itself" that are not the empty string.
 *
 * The page root's real address is `""`, and an empty string is close to
 * invisible to a model: every example beside it shows a real address, and `""`
 * reads as the absence of a value rather than as one. Asked to fill a page it
 * had just created, qwen3.5 tried `"/"`, then `"@doc"`, then `"@page"`,
 * collecting `no node at address "/"` each time, and spent eighteen steps
 * landing a single `<Frame>`. It never once wrote `""`.
 *
 * Only `parent` and `newParent` are normalised. `address` is left alone on
 * purpose: the page root is a legitimate destination to insert into, but
 * `remove_node` and `rename` against it are not things to make easy to reach
 * by a near-miss.
 */
const PAGE_ROOT_ALIASES = new Set(['/', 'page', 'root', '@page', '@root'])

const asParent = (value: string): string =>
  PAGE_ROOT_ALIASES.has(value.trim().toLowerCase()) ? '' : value

/**
 * Which field a kind takes for the node it points at, for the one kind that
 * does not call it `address`. That is exactly the kind a model reaches for
 * `address` on, having just read five other kinds that do.
 */
const ADDRESS_FIELD: Partial<Record<EditOp['kind'], 'parent'>> = { insert_node: 'parent' }

/**
 * Names what the op is missing, and — when the model supplied `address` to a
 * kind that calls it something else — names the swap instead. Observed
 * verbatim: `{"kind":"insert_node","address":"card",…}`, where "needs parent
 * and node" is true but "takes parent, not address" is what closes the gap.
 */
function missing(index: number, op: EditOpInput, fields: string): string {
  const renamed = ADDRESS_FIELD[op.kind]
  const swap =
    renamed && op.address !== undefined && op[renamed] === undefined
      ? ` — it takes ${renamed}, not address`
      : ''
  return `op ${index + 1} (${op.kind}) needs ${fields}${swap}`
}

/**
 * Checks each flat op against the fields its kind actually uses, and hands
 * back the strict `EditOp` the rest of the pipeline expects.
 *
 * A mismatch is a message, never an exception: the model is told which op,
 * which kind, and which field, so its next attempt has somewhere to go — the
 * same contract `edit` already keeps for an op that compiles but cannot apply.
 */
export function narrowOps(ops: readonly EditOpInput[]): NarrowResult<EditOp[]> {
  const narrowed: EditOp[] = []
  for (const [i, op] of ops.entries()) {
    switch (op.kind) {
      case 'set_prop': {
        if (op.address === undefined || op.prop === undefined || op.value === undefined) {
          return { ok: false, message: missing(i, op, 'address, prop and value') }
        }
        narrowed.push({ kind: op.kind, address: op.address, prop: op.prop, value: op.value })
        break
      }
      case 'remove_prop': {
        if (op.address === undefined || op.prop === undefined) {
          return { ok: false, message: missing(i, op, 'address and prop') }
        }
        narrowed.push({ kind: op.kind, address: op.address, prop: op.prop })
        break
      }
      case 'insert_node': {
        if (op.parent === undefined || op.node === undefined) {
          return { ok: false, message: missing(i, op, 'parent and node') }
        }
        narrowed.push({
          kind: op.kind,
          parent: asParent(op.parent),
          node: foldAttrs(op.node),
          ...(op.index === undefined ? {} : { index: op.index }),
        })
        break
      }
      case 'remove_node': {
        if (op.address === undefined) {
          return { ok: false, message: missing(i, op, 'address') }
        }
        narrowed.push({ kind: op.kind, address: op.address })
        break
      }
      case 'move_node': {
        if (op.address === undefined || op.newParent === undefined || op.index === undefined) {
          return { ok: false, message: missing(i, op, 'address, newParent and index') }
        }
        narrowed.push({
          kind: op.kind,
          address: op.address,
          newParent: asParent(op.newParent),
          index: op.index,
        })
        break
      }
      case 'rename': {
        if (op.address === undefined || op.name === undefined) {
          return { ok: false, message: missing(i, op, 'address and name') }
        }
        narrowed.push({ kind: op.kind, address: op.address, name: op.name })
        break
      }
    }
  }
  return { ok: true, value: narrowed }
}
