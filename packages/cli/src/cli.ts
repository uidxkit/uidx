import { createInterface } from 'node:readline/promises'
import { parseArgs } from 'node:util'
import {
  runApply,
  runArchitect,
  runAudit,
  runCreate,
  runEval,
  runIntent,
  runRead,
  runRender,
  runSearch,
  runSelection,
  runStatus,
} from './commands/agent.js'
import { check, NoMatchesError, renderJson, renderText } from './commands/check.js'
import { applyFmt, fmt, renderFmt } from './commands/fmt.js'
import { runMigrateTokens } from './commands/migrate-tokens.js'
import { runMcp } from './commands/mcp.js'
import { runInit } from './commands/init.js'
import { projectFiles } from './project.js'
import { version } from '../package.json'
import { BootError, open } from './commands/open.js'

export const USAGE = `uidx — UI Design in MDX

Usage:
  uidx init              create .uidx/ and add an npm run uidx script
  uidx dev               serve this project’s .uidx workspace
  uidx open [file|dir]    open a page, document, or the current project
  uidx status            show this project’s running server and endpoints
  uidx mcp [--root dir]  connect MCP tools to this project and its viewer
  uidx check <glob...>    parse and validate; exit 1 on any error
  uidx fmt <glob...>      rewrite files in canonical style
  uidx migrate tokens <file...>
                          write the type every <Variable> now declares

Agent commands — read, edit and view designs from a shell without MCP setup.
Start the project server with npm run uidx first. Commands use its tools;
root defaults to the current project, or select one with --root <dir>.
  uidx audit [root] [--page x.uidx] [--format json] [--no-render]
                          every audit against every page; exit 1 on any fault
  uidx apply [root] <page.uidx> --ops <ops.json>
                          apply edit ops through the jail and checkpoints,
                          audits appended like the harness's own edit tool
  uidx create [root] <page.uidx> --id <pageId>
                          create a new empty page, then fill it with apply
  uidx intent [root] <page.uidx> --file body.md
                          replace a page's whole Markdown intent
  uidx eval [root] --file script.js
                          run JS against the document: query with code, write
                          through the same gates as apply
  uidx read [root] <page.uidx> [--address a#b] [--mode outline]
                          one node's source, a subtree outline, or a signature
                          — never a whole 150k page when an address answers it
  uidx search [root] <query...> [--regex] [--limit n]
                          search every page; addresses come back, not files
  uidx render [root] <page.uidx> -o out.png [--address a#b] [--scale 0.5]
                          draw a page or node the way the canvas draws it
  uidx architect [root] <taskId> [--set architecture.json]
                          read or set a task's architecture, same gate as the
                          harness's architect tool
  uidx selection [root] [--format json]
                          what the open viewer has selected right now — the
                          addresses "this" means; exits 1 when no viewer runs

Options for init:
  --script <name>         run script name (default: uidx)
  --port <n>              save the shared viewer/MCP port in .uidx/config.json

Options for dev / open:
  --port <n>              override config.json port (default: 4400, auto-increments)
  --root <dir>            viewer source root (advanced)
  --viewer-dev            serve viewer source with hot reload (local checkout)
  --no-open               do not launch a browser
  --verbose               log parse timings and socket traffic

Options for check:
  --format <text|json>    output format (default: text)

Options for fmt:
  --check                 report what would change; write nothing
  --migrate               bring a pre-<Page> file up to the current shape
  --yes                   do not prompt before overwriting

  -h, --help              show this help
  -v, --version           show version
`

export interface Io {
  out(text: string): void
  err(text: string): void
  cwd?: string
  /**
   * Answers the overwrite prompt. Absent means "no terminal to ask", which is
   * why a non-interactive `uidx fmt` requires `--yes` rather than silently
   * rewriting a CI checkout.
   */
  confirm?(question: string): Promise<boolean>
}

const processIo: Io = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  confirm: process.stdin.isTTY
    ? async (question) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        try {
          return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
        } finally {
          rl.close()
        }
      }
    : undefined,
}

/** Returns the intended exit code rather than calling `process.exit`, so tests can drive it. */
export async function run(argv: string[], io: Io = processIo): Promise<number> {
  const [command, ...rest] = argv

  if (!command) {
    io.err(USAGE)
    return 1
  }
  if (command === '--help' || command === '-h' || command === 'help') {
    io.out(USAGE)
    return 0
  }
  if (command === '--version' || command === '-v') {
    io.out(`${version}\n`)
    return 0
  }

  try {
    switch (command) {
      case 'status':
        return await runStatus(rest, io)
      case 'mcp':
        return runMcp(rest, io)
      case 'init':
        return runInit(rest, io)
      case 'dev':
        return runOpen(rest, io)
      case 'audit':
        return await runAudit(rest, io)
      case 'apply':
        return await runApply(rest, io)
      case 'create':
        return await runCreate(rest, io)
      case 'intent':
        return await runIntent(rest, io)
      case 'eval':
        return await runEval(rest, io)
      case 'read':
        return await runRead(rest, io)
      case 'search':
        return await runSearch(rest, io)
      case 'render':
        return await runRender(rest, io)
      case 'architect':
        return await runArchitect(rest, io)
      case 'selection':
        return await runSelection(rest, io)
      case 'check':
        return runCheck(rest, io)
      case 'fmt':
        return runFmt(rest, io)
      case 'open':
        return runOpen(rest, io)
      case 'migrate':
        // One subcommand for now. `migrate` rather than `migrate-tokens` so the
        // next migration has somewhere to go without a second top-level verb.
        return rest[0] === 'tokens'
          ? runMigrateTokens(rest.slice(1), io)
          : (io.err(`usage: uidx migrate tokens <file...>\n`), 1)
      default:
        io.err(`unknown command "${command}"\n\n${USAGE}`)
        return 1
    }
  } catch (error) {
    io.err(`${(error as Error).message}\n`)
    return 1
  }
}

async function runOpen(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        port: { type: 'string' },
        root: { type: 'string' },
        'viewer-dev': { type: 'boolean', default: false },
        // node:util parseArgs has no `--no-x` negation, so the flag spec §8
        // documents has to be declared under its own name.
        'no-open': { type: 'boolean', default: false },
        verbose: { type: 'boolean', default: false },
      },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }

  const file = parsed.positionals[0] ?? '.'
  if (parsed.positionals.length > 1) {
    io.err('uidx open accepts one file or directory\n')
    return 1
  }
  const port = parsed.values.port ? Number(parsed.values.port) : undefined
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    io.err(`--port must be an integer from 1 to 65535, got ${JSON.stringify(parsed.values.port)}\n`)
    return 1
  }

  try {
    const { server, url } = await open(file, {
      port,
      root: parsed.values.root,
      viewerDev: parsed.values['viewer-dev'],
      launchBrowser: !parsed.values['no-open'],
      verbose: parsed.values.verbose,
      cwd: io.cwd,
    })
    io.out(url ? `uidx serving ${file} at ${url}\n` : `uidx watching ${file} (no viewer root)\n`)
    await waitForInterrupt(server)
    return 0
  } catch (err) {
    if (err instanceof BootError) {
      // Diagnostics, not an operational failure — same stream as `check`.
      io.out(`${err.lines.join('\n')}\n`)
      return 1
    }
    io.err(`${(err as Error).message}\n`)
    return 1
  }
}

/** Resolves on SIGINT/SIGTERM so `uidx open` watches until interrupted. */
function waitForInterrupt(server: { close(): Promise<void> }): Promise<void> {
  return new Promise((resolve) => {
    const stop = () => {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      void server.close().then(() => resolve())
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}

async function runFmt(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        check: { type: 'boolean', default: false },
        migrate: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
      },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }

  const checkOnly = parsed.values.check
  const cwd = io.cwd ?? process.cwd()

  let result
  try {
    const files = parsed.positionals.length ? null : await projectFiles(cwd)
    result = await fmt(parsed.positionals.length ? parsed.positionals : (files ?? ['.']), {
      cwd,
      check: checkOnly,
      migrate: parsed.values.migrate,
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }

  io.out(`${renderFmt(result, cwd, checkOnly)}\n`)
  if (checkOnly || result.changed === 0) return result.exitCode

  if (!parsed.values.yes) {
    const plural = result.changed === 1 ? 'file' : 'files'
    const ok = io.confirm
      ? await io.confirm(`Overwrite ${result.changed} ${plural}?`)
      : (io.err('refusing to overwrite without a terminal; re-run with --yes\n'), false)
    if (!ok) {
      io.out('nothing written\n')
      return 1
    }
  }

  await applyFmt(result, cwd)
  return result.failed > 0 ? 1 : 0
}

async function runCheck(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { format: { type: 'string', default: 'text' } },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }

  const format = parsed.values.format
  if (format !== 'text' && format !== 'json') {
    io.err(`--format must be "text" or "json", got ${JSON.stringify(format)}\n`)
    return 1
  }

  const patterns = parsed.positionals.length ? parsed.positionals : ['.']
  const cwd = io.cwd ?? process.cwd()

  try {
    const files = parsed.positionals.length ? null : await projectFiles(cwd)
    const result = await check(files ?? patterns, { cwd, format })
    // Diagnostics are this command's product, so they go to stdout; only
    // operational failures go to stderr.
    io.out(`${format === 'json' ? renderJson(result) : renderText(result, cwd)}\n`)
    return result.exitCode
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return err instanceof NoMatchesError ? 1 : 1
  }
}
