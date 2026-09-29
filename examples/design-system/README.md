# Example design system

A design system whose components are renders of their `.uidx` identities
(ADRs 0012–0017). Nothing in `generated/` is written by hand.

```
.uidx/            the identities: tokens, Checkbox, Field, CheckboxField, Button, ContactOption, ContactList
vendor/hwc/       the headless behaviour, `@hwc/components`, vendored until it is published
generated/html/   one stylesheet and one markup fragment per component, plus tokens.css
generated/react/  one typed React component per identity, models.ts, runtime.ts, elements.d.ts
generated/contract/  the contract of each page as JSON, for agents and other generators
```

- `pnpm generate` renders `generated/` from `.uidx/`, checking each contract
  against `vendor/hwc/custom-elements.json` first.
- `pnpm check` fails when `generated/` is out of date, which is what `pnpm test` asserts too.
- `pnpm dev` opens a page that mounts the HTML fragments beside the React
  components, both driven by the same custom elements.
- `pnpm typecheck` type-checks the generated React code against React 19.
- `pnpm --filter @uidxkit/uidx dev` from the repository root, pointed at this
  folder, opens the identities in the uidx viewer, where the styles table is
  drawn as a variant set and a repeat shows the model's samples.

To refresh the vendored headless build from a local checkout:
`HWC_DIR=/path/to/headless-web-components/packages/components node scripts/sync-hwc.mjs`.
