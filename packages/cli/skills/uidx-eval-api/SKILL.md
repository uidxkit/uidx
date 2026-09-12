---
name: uidx-eval-api
description: The eval tool's full contract — the five globals, the six op-builder methods, and the five semantics. Load this before writing your first script.
---

# The eval API

Run a JavaScript function body against the document: query with code, write
through the same gates as edit. `return` a value and it comes back as JSON.

## The five semantics

1. **Reads are a snapshot.** `doc()` sees the document as of script start;
   queued ops apply AFTER the script ends. A script cannot read its own
   writes — chain two eval calls for read-modify-read.
2. **Writes are queued, then gated.** `ops(file)` builds one batch per file;
   the batch passes the same refusals as edit (unknown props with a
   did-you-mean, enum values — `layoutMode: 'vertical'` is refused, it is
   `'VERTICAL'` — instances of undefined components, though components the
   batch itself defines count as known), then applies atomically with the
   audits appended. One bad op refuses the whole file's batch; nothing
   half-lands.
3. **One synchronous function body.** 2-second limit; no imports, no
   `eval`/`new Function`, no filesystem, no network. The five globals below
   are the whole world.
4. **Compose big structures in memory.** A `<Component>` inserted with ALL its
   `<Variant>` children in ONE `insert` can never be refused for holding no
   variants. Build the node tree in loops, insert once.
5. **Keep scripts SMALL — one section per script.** Build one thing, read the
   `applied` message (audits ride on it), fix what it names, then write the
   next script. The next call's snapshot includes everything the last one
   applied. A giant everything-script just makes its one refusal expensive.

## The five globals

```ts
/** One node as plain data. No methods — mutate through ops. */
interface NodeView {
  element: string            // Page | Frame | Text | Rectangle | Ellipse | Vector | Instance | Component | Variant | Slot | ...
  name: string | null
  address: string            // the handle every op takes; "#" bounds an entity, "/" walks deeper
  attrs: Record<string, unknown>  // authored values only — defaults are not filled in
  children: NodeView[]
}

doc(file: string): NodeView                 // the whole page; throws if no such page
pages(): string[]                           // every page, tokens documents included
visit(node, fn): void                       // depth-first walk
find(node, predicate): NodeView[]           // every matching node, node itself included

ops(file: string): {                        // the op builder — queued, gated, atomic per file
  set(address, prop, value): void
  removeProp(address, prop): void
  insert(parent, node, index?): void        // parent "" or "/" is the page root; node = {element, attrs?, children?} nested to any depth
  remove(address): void                     // subtree and all
  move(address, newParent, index): void
  rename(address, name): void               // its address changes with it
}

console.log(...): void                      // captured, returned in the outcome's logs
```

## Worked example — a component with computed variants, one insert

```js
const SIZES = { sm: { track: [36, 20], thumb: 16 }, md: { track: [44, 24], thumb: 20 } }
const variants = []
for (const [size, geo] of Object.entries(SIZES)) {
  for (const state of ['off', 'on']) {
    const [tw, th] = geo.track
    variants.push({ element: 'Variant', attrs: { state, size }, children: [{
      element: 'Frame', attrs: { name: 'track', width: tw, height: th, cornerRadius: th / 2, layoutMode: 'NONE' },
      children: [{ element: 'Ellipse', attrs: { name: 'thumb', width: geo.thumb, height: geo.thumb,
        x: state === 'on' ? tw - geo.thumb - 2 : 2, y: (th - geo.thumb) / 2 } }] }] })
  }
}
ops('page.uidx').insert('', { element: 'Component',
  attrs: { name: 'Control/X', x: 1700, variants: { state: ['off', 'on'], size: Object.keys(SIZES) } },
  children: variants })
return { variants: variants.length }
```

Prop vocabulary is the uidx dialect (see the uidx-authoring skill). Bind
tokens as `"{collection#name}"` — never into `characters`.
