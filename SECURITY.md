# Security policy

## Reporting a vulnerability

Use GitHub's [private vulnerability reporting](https://github.com/uidxkit/uidx/security/advisories/new)
when available. If it is unavailable, contact the maintainer through a private
contact method on [their profile](https://github.com/beharguy), or open an issue
requesting a private security contact without disclosing the vulnerability.
Do not include exploit details, tokens or private designs in a public issue.

Include the affected version, operating system, Node version, reproduction
steps, expected impact and a minimal example with sensitive data removed.
Please allow time for investigation and a fix before public disclosure.
This is a community-maintained project; there is no guaranteed response SLA.

## Supported versions

Before the first release, report issues against `main`. After publication,
security fixes target the latest release. Older releases are not maintained
unless an advisory explicitly states otherwise. Use a supported Node LTS
version and install dependency updates.

## Local development boundary

uidx is a local development tool. Its server can read and edit the connected
project's designs. Run it on your own machine, bound to localhost; do not expose
it through a public reverse proxy, a port-forwarding service or a shared server.
It has no multi-user authentication or authorization system.

HTTP and WebSocket requests from other browser origins are rejected. CLI and
MCP clients without browser Origin headers are allowed. Any process able to
connect to localhost can use that interface, including other users on a shared
machine. Project scoping is not an OS
sandbox. Treat agent commands and eval scripts as trusted code, and inspect
unfamiliar repositories before opening them or running their scripts.

Optional AI providers and Google Fonts imports contact the selected external
service. Keep provider keys in local environment configuration; never commit
them. Uploaded fonts and third-party design assets keep their original licenses.

## Release security

CI runs tests, validates the release artifact and checks dependencies. Publishing
requires the release workflow and npm trusted-publisher configuration described
in [the release guide](docs/releasing.md). A failing vulnerability check is a
release blocker, not a reason to suppress an advisory without investigation.

### Reviewed image-size backport

As of 2026-09-12, image-size has no upstream fixed version for
[ICNS non-progressing entries](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr)
and [JXL/HEIF non-progressing boxes](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq).
uidx carries `patches/image-size@1.2.1.patch`: ICNS entries must fit the remaining
input and have an eight-byte header; ISO BMFF boxes must fit the input and make
forward progress, with zero-sized boxes correctly extending to EOF.

The audit accepts only these two advisory IDs at version 1.2.1 through the known
Open Pencil → PptxGenJS dependency path, after checking the patched file hashes
and running malformed-input regression tests in a child process with a timeout.
Installation tests repeat those checks against the published layout. The original
version number is retained, so generic npm/pnpm audits still report these two
findings; the exception is specific to uidx's verified bundle. Remove this backport
when a reviewed upstream fix is available. `expr-eval` is replaced by the maintained
`expr-eval-fork`, and xmldom is pinned to its reviewed fixed version.
