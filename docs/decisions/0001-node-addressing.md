# ADR 0001 — Node addressing resolves §3.4

Status: **superseded** by [ADR 0003](0003-page-root-and-two-level-addressing.md),
2026-08-15. Accepted 2026-08-15, resolving the ambiguity in spec §3.4.

ADR 0003 keeps the reserved `""` root and the name-path scheme, but moves the
root to `<Page>` and adds a component segment to every address. Its rationale 2
(portable override keys) survives intact and is the reason override keys stay
component-relative; rationale 3 rests on one-component-per-file, which ADR 0003
overturns.

## Context

Spec §3.4 contradicted itself. The prose said a node's address is the `/`-joined
name path *from the root*, and that `Component`'s name is the frontmatter `id` —
implying `primary-button/container/label`. The worked example said
`container/leading-icon`, implying the root is excluded.

## Decision

**Addresses are rooted at `Component`'s child. The root `Component` has the
reserved address `""` (the empty string).**

```
Component  ->  ""
Frame      ->  "container"
Text       ->  "container/label"
```

Resolution rule, in full: split the address on `/`; the empty string denotes the
root `Component`; each remaining segment selects the uniquely-named child at that
level.

The frontmatter `id` remains the `Component`'s **name** — it populates the scene
node's `name`, shows in the layers pane, and is what `uidx check` validates for
repo uniqueness. It is not an address segment. Name and address segment coincide
for every node except the root, and that is the only exception.

## Rationale

1. **Renaming the component must not rewrite every address.** Under the rejected
   reading the frontmatter `id` prefixes every address in the file, so editing
   `id:` invalidates every in-flight patch, the scene-id bimap, and any stored
   selection — and does so from the frontmatter, a region §3.1 otherwise
   guarantees the tool never touches.

2. **Overrides must be portable across files.** When `Instance` lands (Phase 5),
   an override key is an address *internal to the main component*, written in a
   different file:

   ```mdx
   <Instance name="button-1" component="primary-button"
     overrides={{ 'container/label': { characters: 'Save' } }} />
   ```

   `container/label` is file-independent. The rejected reading would force
   `primary-button/container/label`, dragging the source file's frontmatter `id`
   into every consuming file, so renaming a component would break override keys
   everywhere it is used. This is the decisive argument.

3. **The prefix carries no information.** One `.uidx` is one component (§2), so
   the leading segment would be the same constant on every line of the file —
   pure length in diagnostics, the layers pane, and the properties panel.

4. **Structural patches need to name the root.** `{ op: 'insert-node', parent }`
   targeting the `Component` needs a value; `""` supplies one without a special
   case in the patch schema.

## Consequences

- `UidxNode.address` for the root is `""`. Every address-taking field of
  `UidxPatch` accepts `""` as "the root Component".
- Scene node ids are set from addresses (`createNodeWithId`), so the §4.2 bimap
  is the identity function for file-parsed nodes. The root's scene id cannot be
  `""`; it uses the frontmatter `id`.
- Multi-file addressing, when it arrives, is `<file-id>#<address>` — the file
  already knows its own id, so it is never baked into the address itself.

## Rejected alternative

Including `Component` in the path (`primary-button/container/label`). Its one
merit — repo-global uniqueness — is better served by `<file-id>#<address>`.
