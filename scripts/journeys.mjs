import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

/**
 * Journeys: what a designer and an agent do in their first hour, walked in a
 * real browser against the built CLI, over a scratch copy of the example
 * design system. Each journey is one of the needs-review checks written down
 * so it runs on every change instead of waiting for someone at a keyboard.
 *
 * Needs `pnpm build:cli`. Set UIDX_CHROMIUM to use an installed Chromium.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = resolve(root, 'packages/cli/dist/uidx.js')
const port = 4971
const url = `http://localhost:${port}`
const exec = promisify(execFile)

const work = await realpath(await mkdtemp(join(tmpdir(), 'uidx-journeys-')))
const project = join(work, 'design-system')
const docroot = join(project, '.uidx')
let server
let browser
let log = ''
const results = []

async function until(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await check()
    if (result) return result
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(log)
    await new Promise((done) => setTimeout(done, 100))
  } while (Date.now() < deadline)
  throw new Error(`timed out\n${log}`)
}

async function journey(name, run) {
  const started = Date.now()
  try {
    await run()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`✔ ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error })
    console.log(`✖ ${name}\n  ${String(error.message).split('\n').join('\n  ')}`)
  }
}

async function uidx(args) {
  return (await exec(process.execPath, [cli, ...args], { cwd: project })).stdout
}

try {
  assert.ok(existsSync(cli), 'run `pnpm build:cli` first')
  await mkdir(project, { recursive: true })
  for (const entry of ['.uidx', 'vendor', 'package.json'])
    await cp(join(root, 'examples/design-system', entry), join(project, entry), { recursive: true })

  server = spawn(process.execPath, [cli, 'open', docroot, '--port', String(port), '--no-open'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (data) => (log += data))
  server.stderr.on('data', (data) => (log += data))
  await until(() => log.includes(`localhost:${port}`))

  const executablePath =
    process.env.UIDX_CHROMIUM ??
    (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined)
  browser = await chromium.launch({ executablePath })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const open = async (query) => {
    await page.goto(`${url}/${query}`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(500)
  }

  await journey('the overview lists every page and reports no problems', async () => {
    await open('')
    for (const name of ['button', 'checkbox', 'contact-list', 'tokens'])
      await page.getByText(name, { exact: true }).first().waitFor({ timeout: 10_000 })
    const problems = page.locator('text=PROBLEMS').locator('..')
    assert.match(await problems.innerText(), /\b0\b/)
  })

  await journey('a page opens on the canvas and its layers are listed', async () => {
    await open('?page=button.uidx')
    await page.locator('canvas').first().waitFor({ state: 'visible' })
    await page.getByText('label', { exact: true }).first().waitFor()
  })

  await journey('selecting a layer shows its properties, then its contract', async () => {
    await open('?page=button.uidx')
    await page.getByText('Button', { exact: true }).first().click()
    await page.getByRole('button', { name: 'Contract' }).first().click()
    await page.getByText('Properties', { exact: false }).first().waitFor()
    await page.getByText('variant', { exact: true }).first().waitFor()
  })

  await journey('the Docs face documents a component and draws its example', async () => {
    await open('?page=checkbox.uidx&view=docs')
    await page.getByRole('heading', { name: /Checkbox/ }).waitFor()
    await page.getByText('toggle', { exact: true }).first().waitFor()
    await page.locator('.example img').first().waitFor({ timeout: 15_000 })
  })

  await journey(
    'a state names what it sets, and Reset hands a value back to the base',
    async () => {
      await open('?page=checkbox.uidx')
      const header = page.locator('.set-header', { hasText: /^\s*checked\s*$/ }).first()
      await header.waitFor()
      const box = await header.boundingBox()
      await page.mouse.click(box.x + 10, box.y + box.height + 18)
      const cells = page.locator('.state-cells')
      await cells.getByText('strokes').waitFor()
      await cells
        .locator('li', { hasText: 'strokes' })
        .getByRole('button', { name: 'Reset' })
        .click()
      await until(
        async () =>
          !/state="checked"[^\n]*root:strokes/.test(
            await readFile(join(docroot, 'checkbox.uidx'), 'utf8'),
          ),
      )
    },
  )

  await journey('the Models face lists the Contact model and who receives it', async () => {
    await open('?page=contact-list.uidx&view=models')
    await page.getByText('Contact', { exact: true }).first().waitFor()
    await page.getByText('ContactList.items[]').first().waitFor()
  })

  await journey('an agent declares a prop through the CLI and the Docs face shows it', async () => {
    const ops = join(work, 'ops.json')
    await writeFile(
      ops,
      JSON.stringify([
        {
          kind: 'declare',
          contractKind: 'prop',
          name: 'loading',
          attrs: { type: 'boolean', default: false, visual: true },
          description: 'Shows progress and blocks activation.',
        },
        {
          kind: 'set_style',
          keys: { state: 'loading' },
          target: 'root',
          prop: 'opacity',
          value: 0.7,
        },
      ]),
    )
    const out = await uidx(['apply', 'button.uidx', '--ops', ops])
    assert.match(out, /applied|changed/i, out)
    const source = await readFile(join(docroot, 'button.uidx'), 'utf8')
    assert.match(source, /<Prop name="loading" type="boolean"/)
    assert.match(source, /<Style state="loading" root:opacity=\{0\.7\} \/>/)
    await open('?page=button.uidx&view=docs')
    await page.getByText('Shows progress and blocks activation.').waitFor()
  })

  await journey('the check stays clean after the agent edit', async () => {
    await uidx(['check', join(docroot, '*.uidx')])
  })

  await journey('no page raised an uncaught error', async () => {
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    const closed = once(server, 'close')
    server.kill('SIGTERM')
    await closed
  }
  await rm(work, { recursive: true, force: true })
}

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} journeys passed`)
if (failed.length) process.exitCode = 1
