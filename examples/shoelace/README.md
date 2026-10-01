# Example: a design system over Shoelace

The same loop as `examples/design-system`, against a library uidx does not
ship: [Shoelace](https://shoelace.style)'s web components. Shoelace supplies
behaviour and accessibility (toggling, keyboard, focus delegation, form
participation, ARIA); the `.uidx` identities supply the look, reaching inside
each element's shadow root through the `::part()`s Shoelace exposes. No
Shoelace theme is loaded: every pixel on the demo page comes from
`generated/`.

```
.uidx/            the identities: tokens (light and dark), Button, Input, Checkbox, Switch
.uidx/uidx.json   the connection — Shoelace's manifest, its naming profile, each component's names in it
generated/html/   one stylesheet (sl-x::part(…) rules) and one markup fragment per component, plus tokens.css
generated/react/  one typed React component per identity over the same elements
generated/contract/  the contract of each page as JSON
```

- `pnpm generate` renders `generated/` from `.uidx/`, checking each contract
  against `node_modules/@shoelace-style/shoelace/dist/custom-elements.json`.
- `pnpm check` (and `pnpm test`) fail when `generated/` is out of date.
- `pnpm dev` opens a page with the HTML fragments beside the React
  components, an event log, and a Dark mode switch — the generated Switch
  itself — that flips `data-color` on `<html>`.
- From the repository root, `pnpm --filter @uidxkit/uidx dev` pointed at this
  folder opens the identities in the viewer. The **Connect** tab is where the
  connection in `uidx.json` was made: the manifest, `coverage: subset`, and
  the bindings (`press → click`, `change → sl-change`, `helpText → help-text`).

## How an identity maps onto a Shoelace element

| In the `.uidx` file | In the generated code |
| --- | --- |
| `<Component implements="sl-button">` | `<sl-button>` |
| `<Frame part="base" …>` | `sl-button::part(base) { … }` |
| `<Slot name="prefix">` | `<span slot="prefix">` (Shoelace declares the slot) |
| `<Text part="input" characters="{placeholder}">` | `placeholder="…"`, an attribute — the text lives in the shadow root |
| `<Style variant="danger" …>` | `sl-button[variant="danger"]::part(base)` |
| `<Style state="checked" …>` | `sl-checkbox[checked]::part(control)` |
| `<Style state="focus" …>` | `sl-checkbox:focus-within::part(control)` |
| `<Collection modes={['light','dark']}>` | `:root { … }` and `[data-color="dark"] { … }` |

Shoelace draws some content itself — the checkbox's check is its own icon —
so the identity styles that part (colour, size) rather than its paths.

## What this example changed in uidx

Running a general-purpose library through the loop surfaced gaps, each fixed
in the packages with a test:

- **adopt** — `sl-input` has a part and a slot both named `prefix`; the
  drafted page now names the part's layer `prefix-part`.
- **coverage** — Shoelace's elements carry far more attributes and events than
  a design system wraps. The profile's `coverage: subset` checks only what
  the contract declares; `full` (the default) still requires the whole element.
  Native DOM events (`click`, `input`, …) count as dispatched.
- **shadow parts** — slot content passes through a shadow part instead of being
  rendered into it, carries `slot="name"`, and an empty library slot prints
  nothing. A part resolves to the root's own `cssParts` before any element
  whose tag merely ends in its name (`label` is not `sl-menu-label`).
- **attributes** — text an element renders from an attribute (`label`,
  `placeholder`, `help-text`) is written as that attribute, and typed `string`
  in React.
- **booleans** — a React boolean reaches a custom element as `true`/`false`,
  since Lit keeps a reflected attribute when the property is set to `undefined`.
- **focus** — a shadow host matches `:focus-within`, never `:focus-visible`.
- **vectors** — an outlined vector's stroke is its `color`, not a border.
- **token modes** — `tokens.css` carries every mode, not just the default.
