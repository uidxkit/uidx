# Contributing to uidx

Bug reports, documentation improvements, tests and code contributions are welcome.
For a large feature or format change, open an issue describing the problem and
proposed behavior before implementing it. Follow the [code of conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities using [SECURITY.md](SECURITY.md).

## Development

Use the Node version in `.nvmrc` and the pnpm version pinned in `package.json`:

```sh
nvm use
corepack enable
pnpm install --frozen-lockfile
pnpm build:cli
pnpm dev
```

Run `pnpm exec uidx init` once to create a local `.uidx/` workspace for development.
This checkout's personal designs are ignored by Git.
Consumer projects install `uidx` as a local devDependency, never as a required
global installation. See [package distribution](docs/package-distribution.md)
for testing a tarball or linking the CLI into another project locally.

## Before opening a pull request

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build:cli
pnpm test
```

For packaging, dependency, startup or CLI changes, also run:

```sh
pnpm test:release
node scripts/pack-release.mjs
pnpm test:install
node scripts/smoke-install.mjs --ignore-scripts
pnpm test:linked
```

Integration tests start temporary localhost servers. Package installation tests
need npm registry access and remove their temporary projects when finished.
The binary tests execute built files, so build before running the full suite.
The root test command runs packages sequentially and limits each suite to two
workers so large design fixtures and timing checks do not compete for all CPUs.
Large generated fixtures have a 20-second test deadline; explicit performance
assertions still enforce their original budgets.

Keep a PR focused. Explain the problem, the resulting behavior and how you
tested it. Update documentation for user-visible changes. Add regression tests
for bugs, especially file write-back, project isolation and release packaging.
Avoid tests that merely duplicate implementation details.

The parser and editor preserve unmodified source spans. Do not reprint an entire
`.uidx` document to change one property. Workspace package imports use a
`development` export condition for source tests and built JavaScript in releases.
The files in `patches/` are deliberate SDK changes; releases must retain them.

## Licensing

Contributions are provided under the project's [MIT license](LICENSE). Include
the source and license for third-party code or assets you add. Do not commit
credentials, local environment files, generated server discovery, or personal
designs. See [third-party notices](THIRD_PARTY_NOTICES.md).

Maintainers use the [release guide](docs/releasing.md) to prepare and publish
the exact artifact tested by CI.
