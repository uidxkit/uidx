import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

/**
 * Installs the packed npm tarball like a real consumer, opens the served
 * viewer in a real Chromium (not jsdom, which cannot create a WebGL context),
 * and fails if the canvas never paints. The dependency suite passed in full
 * the day @open-pencil/core's pinned canvaskit-wasm range was silently
 * violated by a grouped Dependabot bump — nothing exercised real WebGL
 * initialization, so a blank canvas produced no test failure. This is that
 * missing check: a cheap pass/fail canary, not pixel-level visual diffing.
 */

const root = fileURLToPath(new URL('..', import.meta.url))
const tarballs = resolve(root, 'dist/packages')
const screenshotPath = resolve(root, 'canvas-canary.png')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const port = 4970
const exec = promisify(execFile)

const project = await realpath(await mkdtemp(join(tmpdir(), 'uidx-canary-')))
let server
let browser
let log = ''

async function command(bin, args) {
  return (await exec(bin, args, { cwd: project, maxBuffer: 4 * 1024 * 1024 })).stdout
}

async function until(check, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await check()
    if (result) return result
    if (server?.exitCode !== null && server?.exitCode !== undefined) throw new Error(log)
    await new Promise((done) => setTimeout(done, 50))
  } while (Date.now() < deadline)
  throw new Error(`Timed out waiting for the viewer to boot.\n${log}`)
}

try {
  const files = (await readdir(tarballs)).filter((name) => name.endsWith('.tgz'))
  assert.equal(files.length, 1, 'run `pnpm build:cli && node scripts/pack-release.mjs` first')
  const tarball = join(tarballs, files[0])

  await writeFile(join(project, 'package.json'), JSON.stringify({ name: 'canary', private: true }))
  console.log(`Installing ${tarball} in ${project}`)
  await command(npm, [
    'install',
    '--save-dev',
    '--no-audit',
    '--no-fund',
    '--cache',
    join(tmpdir(), 'uidx-npm-cache'),
    tarball,
  ])
  // Postinstall already created .uidx/welcome.uidx and .uidx/config.json (port 4400).
  await writeFile(join(project, '.uidx/config.json'), JSON.stringify({ port }))

  const cli = join(project, 'node_modules/@uidxkit/uidx/dist/uidx.js')
  server = spawn(process.execPath, [cli, 'dev', '--no-open'], {
    cwd: project,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server.stdout.on('data', (data) => (log += data))
  server.stderr.on('data', (data) => (log += data))
  const url = await until(() => log.match(/http:\/\/localhost:\d+/)?.[0])
  assert.equal(url, `http://localhost:${port}`)

  browser = await chromium.launch()
  const page = await browser.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.locator('[class*="page" i], a, button').first().waitFor({ timeout: 10_000 })
  // The overview lists one drawable page card; open it to boot the canvas.
  await page.getByText('welcome', { exact: true }).first().click()
  const canvas = page.locator('canvas').first()
  await canvas.waitFor({ state: 'visible', timeout: 10_000 })
  // CanvasKit's own boot budget is ~100ms; give the WASM fetch and first
  // WebGL frame real headroom in a cold CI container before sampling.
  await page.waitForTimeout(3000)

  const boundingBox = await canvas.boundingBox()
  assert.ok(boundingBox, 'canvas never became visible')
  const screenshot = await canvas.screenshot()
  // Written before the assertions below, so a failing run still leaves
  // behind the screenshot that caused it — not just a byte count.
  await writeFile(screenshotPath, screenshot)
  console.log(`Screenshot saved to ${screenshotPath}`)

  const canvasErrors = consoleErrors.filter((text) => /canvaskit|webgl|getcontext/i.test(text))
  assert.deepEqual(canvasErrors, [], `canvas reported errors:\n${canvasErrors.join('\n')}`)
  // A blank or solid-color canvas compresses to a tiny PNG; real content
  // (background fill, text glyphs) does not. This is a cheap proxy for
  // "something was actually drawn," not a pixel-accurate visual diff.
  assert.ok(
    screenshot.byteLength > 2000,
    `canvas screenshot is only ${screenshot.byteLength} bytes — looks blank`,
  )
  console.log(`Canvas rendered ${screenshot.byteLength} bytes with no errors. Canary passed.`)
} finally {
  await browser?.close()
  if (server && server.exitCode === null) {
    const closed = once(server, 'close')
    server.kill('SIGTERM')
    await closed
  }
  await rm(project, { recursive: true, force: true })
}
