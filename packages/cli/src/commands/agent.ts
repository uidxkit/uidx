import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { connectProjectMcp } from '@uidx/agent/mcp/client'
import { resolveDocumentRoot, viewerSelection } from '@uidx/agent/core'
import type { Io } from '../cli.js'

type Command =
  | 'audit'
  | 'apply'
  | 'create'
  | 'intent'
  | 'eval'
  | 'read'
  | 'search'
  | 'render'
  | 'architect'
  | 'status'

/** Parse locally; all agent functionality executes on the project's viewer server. */
async function remote(command: Command, argv: string[], io: Io): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      root: { type: 'string' },
      page: { type: 'string' },
      format: { type: 'string' },
      'no-render': { type: 'boolean' },
      ops: { type: 'string' },
      id: { type: 'string' },
      file: { type: 'string' },
      address: { type: 'string' },
      mode: { type: 'string' },
      regex: { type: 'boolean' },
      limit: { type: 'string' },
      set: { type: 'string' },
      scale: { type: 'string' },
      out: { type: 'string', short: 'o' },
    },
  })
  const cwd = io.cwd ?? process.cwd()
  const read = (file: string) => readFile(resolve(cwd, file), 'utf8')
  let root = values.root
  let target: string | undefined
  let query: string[] = []
  if (['audit', 'eval', 'status'].includes(command)) {
    if (positionals.length > 1) throw new Error(`uidx ${command} accepts at most one project root`)
    root ??= positionals[0]
  } else if (command === 'search') {
    const [first] = positionals
    const explicit =
      !root &&
      positionals.length > 1 &&
      first !== undefined &&
      (await stat(resolve(cwd, first)).then(
        (info) => info.isDirectory(),
        () => false,
      ))
    if (explicit) {
      root = first
      query = positionals.slice(1)
    } else query = positionals
  } else {
    if (positionals.length > 2 || (root && positionals.length > 1))
      throw new Error(`uidx ${command} needs one page or task id`)
    if (positionals.length === 2) {
      root = positionals[0]
      target = positionals[1]
    } else target = positionals[0]
    if (!target)
      throw new Error(
        `uidx ${command} needs a ${command === 'architect' ? 'task id' : 'page.uidx'}`,
      )
  }
  const args: Record<string, unknown> = {}
  switch (command) {
    case 'audit':
      if (values.format && !['json', 'text'].includes(values.format))
        throw new Error('--format must be text or json')
      if (values.page) args.page = values.page
      args.render = !values['no-render']
      break
    case 'apply':
      if (!values.ops) throw new Error('uidx apply needs --ops <ops.json>')
      args.page = target
      args.ops = JSON.parse(await read(values.ops))
      break
    case 'create':
      if (!values.id) throw new Error('uidx create needs --id <pageId>')
      args.page = target
      args.pageId = values.id
      break
    case 'intent':
      if (!values.file) throw new Error('uidx intent needs --file <body.md>')
      args.page = target
      args.body = await read(values.file)
      break
    case 'eval':
      if (!values.file) throw new Error('uidx eval needs --file <script.js>')
      args.script = await read(values.file)
      break
    case 'read':
      args.page = target
      if (values.address) args.address = values.address
      if (values.mode) args.mode = values.mode
      break
    case 'search':
      if (!query.length) throw new Error('uidx search needs a query')
      args.query = query.join(' ')
      if (values.regex) args.regex = true
      if (values.limit) args.limit = Number(values.limit)
      break
    case 'render':
      if (!values.out) throw new Error('uidx render needs -o <out.png>')
      args.page = target
      if (values.address) args.address = values.address
      if (values.scale) args.scale = Number(values.scale)
      break
    case 'architect':
      args.taskId = target
      if (values.set) args.set = JSON.parse(await read(values.set))
      break
  }
  const client = await connectProjectMcp(resolve(cwd, root ?? '.'))
  try {
    const result = await client.callTool({ name: `uidx_${command}`, arguments: args })
    const content = result.content as { type: string; text?: string; data?: string }[]
    const text = content
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n')
    if (
      result.isError ||
      /^(not applied|not created|not written|not set|refused|eval failed|no architecture|no such page|no node at|invalid regex|regex query too long|query must not be empty)/i.test(
        text,
      )
    ) {
      io.err(`${text}\n`)
      return 1
    }
    if (command === 'render') {
      const image = content.find((block) => block.type === 'image')
      if (!image?.data) throw new Error(text || 'The server returned no render')
      const png = Buffer.from(image.data, 'base64')
      await writeFile(resolve(cwd, values.out!), png)
      io.out(`${values.out} (${Math.round(png.length / 1024)}KB)\n`)
      return 0
    }
    if (command === 'audit') {
      const reports = JSON.parse(text) as { file: string; faults: string[]; renders?: boolean }[]
      if (values.format === 'json') io.out(`${text}\n`)
      else
        for (const report of reports) {
          io.out(
            report.faults.length
              ? `${report.file}: ${report.faults.length} fault(s)\n${report.faults.map((fault) => `  - ${fault}\n`).join('')}`
              : `${report.file}: clean${report.renders ? ', renders' : ''}\n`,
          )
        }
      return reports.some((report) => report.faults.length) ? 1 : 0
    }
    io.out(`${text}\n`)
    if (command === 'eval') {
      const outcome = JSON.parse(text) as { applied: { ok: boolean }[] }
      return outcome.applied.every((entry) => entry.ok) ? 0 : 1
    }
    return 0
  } finally {
    await client.close()
  }
}

export const runAudit = (argv: string[], io: Io) => remote('audit', argv, io)
export const runApply = (argv: string[], io: Io) => remote('apply', argv, io)
export const runCreate = (argv: string[], io: Io) => remote('create', argv, io)
export const runIntent = (argv: string[], io: Io) => remote('intent', argv, io)
export const runEval = (argv: string[], io: Io) => remote('eval', argv, io)
export const runRead = (argv: string[], io: Io) => remote('read', argv, io)
export const runSearch = (argv: string[], io: Io) => remote('search', argv, io)
export const runRender = (argv: string[], io: Io) => remote('render', argv, io)
export const runArchitect = (argv: string[], io: Io) => remote('architect', argv, io)
export const runStatus = (argv: string[], io: Io) => remote('status', argv, io)

async function commandRoot(root: string | undefined, io: Io): Promise<string> {
  return resolveDocumentRoot(resolve(io.cwd ?? process.cwd(), root ?? '.'))
}
export async function runSelection(argv: string[], io: Io): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { format: { type: 'string', default: 'text' }, root: { type: 'string' } },
    })
  } catch (err) {
    io.err(`${(err as Error).message}\n`)
    return 1
  }
  if (parsed.positionals.length > (parsed.values.root ? 0 : 1)) {
    io.err('uidx selection accepts one project root\n')
    return 1
  }
  if (!['json', 'text'].includes(parsed.values.format!)) {
    io.err('--format must be text or json\n')
    return 1
  }
  const root = await commandRoot(parsed.values.root ?? parsed.positionals[0], io)

  const result = await viewerSelection(root)
  if (result.viewer === 'none') {
    io.err(`${result.reason}\n`)
    return 1
  }
  if (parsed.values.format === 'json') {
    io.out(`${JSON.stringify(result.selection, null, 2)}\n`)
    return 0
  }
  if (result.selection.addresses.length === 0) {
    io.out('nothing selected\n')
    return 0
  }
  for (const address of result.selection.addresses) io.out(`${address}\n`)
  return 0
}
