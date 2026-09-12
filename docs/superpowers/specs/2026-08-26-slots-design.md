# Slots — a component declares a hole, a consumer fills it

2026-08-26. Approved in conversation, section by section.
Backlog story: **F5**. Model decision:
[ADR 0007](../../decisions/0007-slots.md). Reference studied:
Figma's [Use slots to build flexible components](https://help.figma.com/hc/en-us/articles/38231200344599-Use-slots-to-build-flexible-components-in-Figma).

## The problem

An instance can change what is already there and cannot put anything new
inside. That is why a design system grows `Card/WithChart`, `Card/WithTable`
and `Card/WithList` — three components identical everywhere but one region.

F3 shipped instances, F6 let a component declare its properties and F7 let an
instance fill them in, which together made *using* a component mean choosing
its content rather than reaching inside it. But every one of those choices is
a **scalar**: a string, a boolean, a component name. Nothing yet lets a
consumer supply a *tree*.

F5 also closes a gap F3 named out loud. An instance's children are generated,
absent from the bimap and therefore absent from `doc.tree` — so the layers
rail has nothing to show inside an instance. Slot fill is authored, so it is
in `doc.tree` already, and it becomes the first content under an instance
that can be selected, edited and dragged.

## What this rests on

ADR 0007's decisions, and two prior ones it leans on directly:

| Decision | Source |
|---|---|
| `<Slot>` is an element, not a `SLOT` component property | ADR 0007 §1 |
| Same element declares and fills; position decides which | ADR 0007 §2 |
| Fill is keyed by slot **name**, never by path | ADR 0007 §2, F6's thesis |
| Filling replaces the default outright; no merge | ADR 0007 §2 |
| Scene id follows the definition, address follows the file | ADR 0007 §3 |
| An override into a *filled* slot is an error | ADR 0007 §4 |
| Deleting a slot is a check error at every fill site | ADR 0007 §5 |
| `.fig` export flattens and reports it | ADR 0007 §6, deferred to F2 |
| A slot's layout belongs to the definition | F5 |
| "Absent from the bimap" means "the SDK made this, do not write" | D4 |

Two things are **measured, not assumed**, and both are recorded in ADR 0007's
Context: the SDK's `NodeType` has eighteen values and none is a slot, and the
only occurrence of the word "slot" anywhere in `@open-pencil` is a sentence
inside a React codegen prompt. There is nothing in the engine to map onto, so
`toSceneGraph` decides what a slot is.

## Scope

| Package | Change |
|---|---|
| `@uidx/format` | `Slot` in `ELEMENTS`; `Instance` becomes a container; `INSTANCE_CHILD_ELEMENTS`; position-dependent attribute rules; four new codes (UIDX130–133); a `slots()` reader beside `componentProps()` |
| `@uidx/schema` | `NODE_TYPE.Slot = 'FRAME'`; `expandInstance` substitutes fill for default and **links** fill nodes into the bimap; `create.ts` gains a `<Slot>` spec |
| `@uidx/server` | Three cross-page codes (UIDX410–412) in `buildSymbolTable`: unknown slot, orphaned fill, override into a filled slot |
| `@uidx/viewer` | `<Slot>` row and icon in the rail; drop targeting; reset / delete-contents menu; "New slot" and "Convert to slot" |
| `@uidx/cli` | The seven diagnostics reach `uidx check` for free; `examples/card.uidx` as the worked example |

## Grammar — `@uidx/format`

### `<Slot>` joins the whitelist

```ts
// types.ts
export const ELEMENTS = [ /* … */ 'Instance', 'Variant', 'Slot', /* … */ ] as const

CONTAINER_ELEMENTS  += 'Slot', 'Instance'
NODE_CHILD_ELEMENTS += 'Slot'          // a slot may sit inside a frame
export const INSTANCE_CHILD_ELEMENTS: ReadonlySet<string> = new Set(['Slot'])
export const SLOT_CHILD_ELEMENTS = NODE_CHILD_ELEMENTS
```

`SLOT_CHILD_ELEMENTS` contains `Slot`, so a slot may sit in another slot's
default content. It may **not** sit inside a fill — that is a position, not a
parent element, so the table cannot say it and the parser does, exactly as it
does for a `<Variant>` under a component that declares no `variants`.

`Slot` is **absent** from `PAGE_CHILD_ELEMENTS` (a hole outside a component
has nobody to fill it) and **absent** from `COMPONENT_CHILD_ELEMENTS` (ADR
0007 §1 — a component that is nothing but a hole declares no contract). It is
a `SceneElement`, so it lowers.

`Instance` moves into `CONTAINER_ELEMENTS`. Its comment in `types.ts` says it
has no children in the file; that comment is now wrong and is rewritten
rather than deleted, because the *reason* still holds for everything except a
`<Slot>`.

### Position decides what a `<Slot>` may carry

The one rule the whole ergonomic story rests on:

| Position | `name` | Scene properties | Children |
|---|---|---|---|
| inside a `<Component>` / `<Frame>` / `<Variant>` / `<Slot>` | required | **all of them** | default content |
| directly inside an `<Instance>` | required | **none** | the content |

A fill-side `<Slot>` carrying `layoutMode` is UIDX131, with the message
naming the definition as the place to change it. This is the same carve-out
`<Variant>` has for owning no geometry, said the other way round: a
`<Variant>` never has geometry anywhere, a `<Slot>` has it in exactly one
position.

### Uniqueness

- **Declaration side:** slot names unique within a `<Component>`, across the
  whole subtree, not just among siblings — the name is a flat contract, so
  `container/body` and `footer/body` would be two slots called `body`
  (UIDX130). For a component with variants, uniqueness is per `<Variant>`,
  because each variant is a full tree.
- **Fill side:** at most one `<Slot name="x">` per `<Instance>` (UIDX132).

Sibling-name uniqueness (UIDX102) already covers everything else, since a
`<Slot>` is an ordinary named node to its siblings.

### The reader

```ts
// component-props.ts's neighbour, and deliberately shaped like it
export function slots(component: UidxNode): {
  declared: Map<string, UidxNode>      // slot name -> the <Slot> node
  problems: SlotProblem[]
}
export function slotFills(instance: UidxNode): {
  fills: Map<string, UidxNode>         // slot name -> the fill <Slot> node
  problems: SlotProblem[]
}
```

Returns both rather than throwing, for `componentProps`'s stated reason:
`uidx check` wants every problem in one pass and the viewer wants whatever is
well-formed so it can still draw.

## Render — `@uidx/schema`

### `NODE_TYPE.Slot = 'FRAME'`

Not a second entry in `nodeTypeFor`. A slot is unconditionally a frame; only
`Component` is conditional, and only because `variants` makes it a set.

### `expandInstance` gains substitution and linking

The change is confined to the `clone` closure at
[to-scene.ts:696](../../../packages/schema/src/to-scene.ts). Today it clones
every node of the definition and links nothing. It gains one branch and one
call:

```ts
const clone = (source, parentId, relative) => {
  const id = addressOf(parentId, source.name)
  graph.createNodeWithId(id, NODE_TYPE[source.element], parentId, { …props, …override })

  if (source.element === 'Slot') {
    const fill = fills.get(source.name)          // authored, from the consuming page
    if (fill) {
      // Address follows the file; scene id follows the definition (ADR 0007 §3).
      addresses.link(fill.address, id)
      for (const child of fill.children) authored(child, id, fill.address)
      return                                     // the default is replaced, not merged
    }
  }
  // …unchanged: clone the definition's children
}
```

`authored` is `clone`'s sibling and the difference between them is the whole
of D4:

| | resolves aliases in | links into the bimap | may be patched |
|---|---|---|---|
| `clone` — a node of the definition | the **definition's** scope (F6's `withProperties` wrapper) | no | no |
| `authored` — a node of the fill | the **consuming page's** scope | yes | yes, into the consuming page |

The scope split is not new — it is exactly what `overrideProps` already does,
and for the same reason: content written by the consumer resolves in the
consumer's world, so `{radius#md}` in a fill is the consuming page's token
and a bare `{label}` there is a mistake rather than the component's property.

An `<Instance>` inside a fill recurses through `expandInstance` with the
consuming page's scope and the existing `seen` chain.

### Where the addresses land

For `<Instance name="card-1" component="Card">` with `Card`'s slot at
`container/body`:

```
address                   scene id                       source of truth
card-1                    card-1                         consuming page
card-1#container          card-1#container               Card — generated
card-1#container/title    card-1#container/title         Card — generated
card-1#body               card-1#container/body          consuming page  ← fill <Slot>
card-1#body/figure        card-1#container/body/figure   consuming page
```

Three properties to hold, and each has a test:

1. **`addressOf` on a generated id is `undefined`.** Unchanged, and now
   exercised on a tree where its siblings are defined.
2. **`sceneIdOf('card-1#body/figure')` is the definition-shaped id.** The one
   genuinely new thing: the bimap's two maps stop being mirror images.
3. **`unlink('card-1#body')` drops the whole fill.** It walks by address
   containment, so it already does — but a fill is the first subtree whose
   ids do *not* share the prefix being unlinked, so it needs pinning.

### Variants

`variantFor` picks the tree before `clone` runs, so a slot inside a
`<Variant>` needs no code. Switching a variant re-applies the fill by name,
the way an override re-applies by path (ADR 0005 §3). A fill naming a slot
the *chosen* variant does not declare is UIDX410 with the variant named — the
sparse-combination story, one level in.

## Diagnostics

Four in `@uidx/format` (single-file, structural):

| Code | Meaning |
|---|---|
| `UIDX130` `DUPLICATE_SLOT` | Two `<Slot>`s with one name in a component. The name is the contract; it cannot be ambiguous. |
| `UIDX131` `SLOT_FILL_SHAPE` | A fill-side `<Slot>` carrying scene properties. Message names the definition as where layout lives. |
| `UIDX132` `DUPLICATE_SLOT_FILL` | Two fills for one slot on one instance. |
| `UIDX133` `SLOT_NOT_ALLOWED_HERE` | A `<Slot>` on a page, as a component's direct child, or inside a fill. Distinct from UIDX106 because the message must say *why* each position is refused. |

Three in `@uidx/server` (cross-page, in `buildSymbolTable` beside
`UNDECLARED_PROPERTY_VALUE`):

| Code | Meaning |
|---|---|
| `UIDX410` `UNKNOWN_SLOT` | A fill naming a slot the component does not declare. Lists the slots that exist — the same courtesy UIDX405 pays for properties. |
| `UIDX411` `ORPHANED_SLOT_FILL` | The component **no longer** declares a slot that fills exist for. This is §5's headline: Figma's destructive-action warning becomes an error at every site, by page and address. |
| `UIDX412` `OVERRIDE_INTO_FILLED_SLOT` | An `overrides` key whose path enters a slot this instance fills. Two ways to say one thing, with no stated winner. |

`UIDX411` is the same diagnostic as `UIDX410` from the checker's point of
view — a fill with no slot — but a different message, because the two have
different fixes: add the slot back, or delete the fill. The checker
distinguishes them by whether *any* component in the document still declares
that name.

## Editor — `@uidx/viewer`

Two halves, and they land in that order. **The file grammar and the renderer
ship first**; every gesture below is a patch over machinery that already
exists once they do.

### Authoring, in the defining page

- **New slot** — inserts `<Slot name="body" />` as a sibling, one
  `insert-node` patch, and leaves it **selected**. Selecting it is not
  polish: with no empty-slot indicator (ADR 0007's last rejected
  alternative), a slot with no default renders nothing, and this is the
  gesture that makes one.
- **Convert to slot** — on a selected `<Frame>` inside a component, rewrites
  the element name in place. Its children become the default content and its
  layout stays exactly where it was, so the canvas does not move. This is
  Figma's ⌘⇧S, and here it is one span rewrite.

Insert is primary and convert is the retrofit path — the reverse of Figma's
emphasis, because in Figma there is no slot object to insert and here there
is.

- **The rail shows a `<Slot>` row** whether or not it draws anything, because
  the rail reads `doc.tree` rather than the scene graph (D3). That is what
  keeps an empty hole findable without a canvas indicator.

### Filling, in the consuming page

- **Drag into a slot** — onto its region on canvas, or onto its row in the
  rail. Reuses D3's `moveFor` rulebook and D7's flow-slot cursor, with one
  difference that matters: the commit is an `insert-node` into the
  **consuming** page, creating the `<Slot name>` wrapper if this is the first
  fill, rather than a `move-node`.
- **Place an instance into a slot** — F11's toolbar gesture, targeting a slot
  under the cursor. Figma's "Add instances".
- **Reset slot** — `remove-node` on the fill `<Slot>`; the default returns.
- **Delete contents** — removes the fill's children, leaving
  `<Slot name="body" />`. ADR 0007 §2's third state, and the reason it has a
  spelling.

Selection inside a filled slot needs no new rule: `isAddressable` is
`addresses.addressOf(id) !== undefined`, which is already true of fill nodes
and already false of generated ones.

## Out of scope

- **Content contracts** — `min` / `max` layer counts, preferred instances,
  "only allow preferred instances". Figma's own note is that limits "guide
  rather than restrict". A `<Slot>` with no `max` is a `<Slot>` with no
  limit, so this costs nothing to add later.
- **An empty-slot indicator on canvas** (Figma's pink box). Its two
  consequences are absorbed above: insert leaves the slot selected, and the
  rail shows the row.
- **`.fig` export.** F2's, and ADR 0007 §6 states what it must do: `<Slot>` →
  `FRAME`, fill → children, the loss reported rather than silent. The
  rendering survives; the hole does not.
- **Merging fill with default content.** Rejected in ADR 0007 §2.
- **A `SLOT` property type.** `PROPERTY_TYPES` stays three.

## How this gets verified

| Claim | Test |
|---|---|
| A `<Slot>` is legal in a frame, a variant and a slot's default; illegal on a page, as a component's direct child, and inside a fill | `@uidx/format` grammar tests, one per position, asserting UIDX133 |
| A fill-side `<Slot>` takes `name` only | UIDX131 on `layoutMode`, `width`, `fills` |
| An unfilled slot renders its default; a self-closing fill renders nothing; a filled slot renders the fill and **not** the default | three `toSceneGraph` cases over one fixture |
| Fill nodes are writable, generated nodes are not | `addressOf` defined for `card-1#body/figure`, `undefined` for `card-1#container/title`, in one graph |
| Scene id and address diverge exactly as ADR 0007 §3 says | `sceneIdOf('card-1#body/figure') === 'card-1#container/body/figure'` |
| A patch to a fill lands in the consuming page, not the defining one | `fromSceneChange` round trip through the server's page-addressed envelope |
| Moving the slot inside the definition changes no consuming page | edit `Card`, re-check every fixture, assert zero diagnostics and zero patches |
| Switching a variant re-applies the fill by name | one component, two variants, one fill, both combinations rendered |
| An instance inside a fill expands, and a cycle through a fill terminates | reuses `expandInstance`'s `seen` fixture |
| Deleting a slot names every fill site | multi-page fixture through `buildSymbolTable`, asserting UIDX411 twice with distinct addresses |

`examples/card.uidx` and a consuming page carry the worked example, so
`uidx check` over `examples/` is itself a regression test — which is how
every prior story in this repo has been kept honest.
