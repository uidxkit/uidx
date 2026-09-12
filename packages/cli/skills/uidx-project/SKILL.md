---
name: uidx-project
description: Create or edit this project's .uidx designs and coordinate CLI or MCP changes with its running uidx viewer.
---

# Project-local uidx

Design content lives under `.uidx/` at the application's package root.
`.uidx/uidx.json` declares page and asset membership; paths passed to MCP tools
and editing commands are relative to that document, such as `button.uidx`.
Images live under `.uidx/assets/` and use `src="assets/logo.svg"`.

Install `uidx` as a local devDependency with `npm install --save-dev uidx`.
Installation initializes `.uidx/` and the npm scripts; if install scripts are
disabled, run `npx --no-install uidx init` once. No global installation is needed.

Use the project's installed `uidx` executable. Run `npm run uidx` to open the
viewer (a project may choose another script name). For an existing standalone
document, pass its directory explicitly instead. Check `npx --no-install uidx
--help` for the available commands.

`npm run uidx` starts the project server, which serves the viewer and MCP on
one port. Set the preferred port in `.uidx/config.json` (`{"port":4400}`), or
override it for a run with `--port`. The server and viewer are dependencies in
`node_modules`; `.uidx/` stores the project's designs and configuration.

The generated `.mcp.json` registers `npm run --silent uidx:mcp`, a stdio bridge
to that running server. Start the MCP client from this project root. Tools
default to the connected project and refuse a different root.

Agents with shell access can use every project tool through the CLI without
configuring an MCP client. Start `npm run uidx -- --no-open` in a persistent
terminal or background process, then run commands below in another shell.
`npx --no-install uidx status` confirms the project root and live endpoints.

When the user refers to a selection, call `uidx_selection` or run
`npx --no-install uidx selection --format json`. This reads the actual viewer
selection. If no viewer is open, start the project viewer when appropriate;
do not infer what the user selected.

Read a page outline or a named node before editing it. CLI equivalents:

```sh
npx --no-install uidx read welcome.uidx --mode outline
npx --no-install uidx apply welcome.uidx --ops edits.json
npx --no-install uidx create button.uidx --id button
npx --no-install uidx eval --file edits.js
npx --no-install uidx search Button
npx --no-install uidx render welcome.uidx -o /tmp/welcome.png
npx --no-install uidx audit --format json
npx --no-install uidx check
```

CLI commands and MCP tools use the same running server and edit engine. Node
edits go through its session and update the canvas. Open the PNG from `render`
to inspect the design visually; `read` and `search` inspect its structure.
`intent` writes Markdown intent, and `architect` reads or sets task architecture.
Inspect refusal messages and nonzero exit codes before retrying; use the returned
addresses and current document state. `check` and `fmt` also work offline.

For node grammar, read [uidx-authoring](../uidx-authoring/SKILL.md). For JavaScript
batch edits, read [uidx-eval-api](../uidx-eval-api/SKILL.md). When asked to document
a component, read [uidx-component-docs](../uidx-component-docs/SKILL.md).
