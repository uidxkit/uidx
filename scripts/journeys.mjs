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

  await journey('the Docs face shows the component as the generated code renders it', async () => {
    const response = await page.request.get(`${url}/__uidx/preview?component=button`)
    assert.equal(response.status(), 200)
    assert.match(await response.text(), /<hwc-button/)
    await open('?page=button.uidx&view=docs')
    await page.locator('iframe.code-preview').waitFor()
  })

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

  await journey('an instance resizes on the canvas while its handle is held', async () => {
    // Button has a styles table, so an instance draws its pill on a frame
    // inside a variant wrapper — a frame only a build used to resize, so the
    // pill stayed put under the moving handle and jumped once the file came
    // back. The spacers hold the fit still, whatever the button measures.
    await writeFile(
      join(docroot, 'live-resize.uidx'),
      [
        '---',
        'id: live-resize',
        '---',
        '',
        '## Visual Contract',
        '',
        '<Page>',
        `  <Instance name="go" component="Button" x={0} y={0} width={160} props={{ label: 'Go' }} />`,
        '  <Frame name="spacer" x={-200} y={-150} width={10} height={10} />',
        '  <Frame name="spacer-2" x={500} y={200} width={10} height={10} />',
        '</Page>',
        '',
      ].join('\n'),
    )
    // A page the server has not listed yet opens the entry page instead.
    const layer = page.getByText('go', { exact: true })
    await until(async () => {
      await open('?page=live-resize.uidx')
      return (await layer.count()) > 0
    })
    // Inside the rulers and above the toolbar, which both paint in blue too.
    const canvas = await page.locator('canvas').last().boundingBox()
    const area = {
      x: canvas.x + 24,
      y: canvas.y + 24,
      width: canvas.width - 24,
      height: canvas.height - 120,
    }
    /**
     * The pill's box on screen: the pixels painted in the button's accent
     * fill, read back from a screenshot of the canvas. The selection outline,
     * its handles and the white label all fall outside the test.
     */
    const pill = async () => {
      const png = await page.screenshot({ clip: area })
      return page.evaluate(async (data) => {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${data}`)).blob(),
        )
        const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = surface.getContext('2d')
        context.drawImage(bitmap, 0, 0)
        const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
        const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
        for (let y = 0; y < bitmap.height; y++) {
          for (let x = 0; x < bitmap.width; x++) {
            const at = (y * bitmap.width + x) * 4
            const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]]
            if (!(b > 200 && r < 110 && g > 120 && g < 190)) continue
            box.left = Math.min(box.left, x)
            box.right = Math.max(box.right, x)
            box.top = Math.min(box.top, y)
            box.bottom = Math.max(box.bottom, y)
          }
        }
        return { ...box, width: box.right - box.left + 1 }
      }, png.toString('base64'))
    }
    await layer.first().click()
    await page.waitForTimeout(300)
    const before = await pill()
    assert.ok(before.width > 100, `no button on the canvas: ${JSON.stringify(before)}`)
    // The east handle sits on the box's right edge, halfway down.
    const grip = {
      x: area.x + before.right + 1,
      y: area.y + Math.round((before.top + before.bottom) / 2),
    }
    await page.mouse.move(grip.x, grip.y)
    await page.mouse.down()
    for (let step = 1; step <= 10; step++) await page.mouse.move(grip.x + step * 10, grip.y)
    await page.waitForTimeout(200)
    const held = await pill()
    await page.mouse.up()
    assert.ok(
      Math.abs(held.width - (before.width + 100)) <= 3,
      `the pill drew ${held.width} wide under a handle dragged from ${before.width} to ${before.width + 100}`,
    )
    await until(async () =>
      /name="go"[^\n]*width=\{2\d\d\}/.test(
        await readFile(join(docroot, 'live-resize.uidx'), 'utf8'),
      ),
    )
    await page.waitForTimeout(500)
    const settled = await pill()
    assert.ok(
      Math.abs(settled.width - held.width) <= 2,
      `the pill drew ${held.width} wide while held and ${settled.width} once the file came back`,
    )
  })

  await journey(
    'an instance’s padding, scrubbed and handed back, draws as the file says',
    async () => {
      // ADR 0018 §7: the canvas draws a scrub of an instance's outer box on the
      // frame its component wraps, and holds it there so a document landing
      // mid-scrub does not undo it. The release has to let go: a hold the pane
      // never handed back kept the pill wide after ↺, Reset all or undo had
      // taken the padding out of the file. A component of the journey's own,
      // with a styles table, so its box is the derived frame inside a wrapper.
      await writeFile(
        join(docroot, 'tag.uidx'),
        [
          '---',
          'id: tag',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          '  <Component name="Tag" status="draft"',
          '    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"',
          '    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"',
          '    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}',
          "    fills={[{ type: 'SOLID', color: { r: 0.1, g: 0.6, b: 0.3, a: 1 } }]}>",
          `    <Text name="label" characters="{label}" fontSize={14} fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />`,
          '  </Component>',
          '</Page>',
          '',
          '<Styles>',
          `  <Style state="hover" root:fills={[{ type: 'SOLID', color: { r: 0.05, g: 0.4, b: 0.2, a: 1 } }]} />`,
          '</Styles>',
          '',
          '## Contract',
          '',
          '<Props>',
          '  <Prop name="label" type="string" sample="Tag">The words it shows.</Prop>',
          '</Props>',
          '',
        ].join('\n'),
      )
      const file = join(docroot, 'restyle-page.uidx')
      await writeFile(
        file,
        [
          '---',
          'id: restyle-page',
          '---',
          '',
          '## Visual Contract',
          '',
          '<Page>',
          `  <Instance name="restyled" component="Tag" x={0} y={0} props={{ label: 'Hugging' }} />`,
          '  <Frame name="spacer" x={-200} y={-150} width={10} height={10} />',
          '  <Frame name="spacer-2" x={500} y={200} width={10} height={10} />',
          '</Page>',
          '',
        ].join('\n'),
      )
      const layer = page.getByText('restyled', { exact: true })
      await until(async () => {
        await open('?page=restyle-page.uidx')
        return (await layer.count()) > 0
      })
      const canvas = await page.locator('canvas').last().boundingBox()
      const area = {
        x: canvas.x + 24,
        y: canvas.y + 24,
        width: canvas.width - 24,
        height: canvas.height - 120,
      }
      /** The tag's box on screen: the pixels painted in its green, read back from a screenshot. */
      const tag = async () => {
        // Off the panel first: a hovered padding field tints the band it governs.
        await page.mouse.move(4, 4)
        await page.waitForTimeout(200)
        const png = await page.screenshot({ clip: area })
        return page.evaluate(async (data) => {
          const bitmap = await createImageBitmap(
            await (await fetch(`data:image/png;base64,${data}`)).blob(),
          )
          const surface = new OffscreenCanvas(bitmap.width, bitmap.height)
          const context = surface.getContext('2d')
          context.drawImage(bitmap, 0, 0)
          const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height).data
          const box = { left: Infinity, right: -Infinity }
          for (let y = 0; y < bitmap.height; y++) {
            for (let x = 0; x < bitmap.width; x++) {
              const at = (y * bitmap.width + x) * 4
              const [r, g, b] = [pixels[at], pixels[at + 1], pixels[at + 2]]
              if (!(g > 120 && g < 190 && g - r > 40 && g - b > 30)) continue
              box.left = Math.min(box.left, x)
              box.right = Math.max(box.right, x)
            }
          }
          return { ...box, width: box.right - box.left + 1 }
        }, png.toString('base64'))
      }
      const line = async () =>
        (await readFile(file, 'utf8')).split('\n').find((text) => text.includes('name="restyled"'))
      await layer.first().click()
      await page.waitForTimeout(300)
      const before = await tag()
      assert.ok(before.width > 40, `no tag on the canvas: ${JSON.stringify(before)}`)

      /** Scrubs the horizontal padding wider and lets go: the file states it, and the tag grows. */
      const scrub = async () => {
        const handle = await page
          .locator('[data-field="instance-padding"] .padding-box[data-axis="horizontal"] .scrub')
          .boundingBox()
        const grip = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 }
        await page.mouse.move(grip.x, grip.y)
        await page.mouse.down()
        for (let step = 1; step <= 12; step++) await page.mouse.move(grip.x + step * 2, grip.y)
        await page.mouse.up()
        await until(async () => /paddingLeft=\{\d+\}/.test(await line()))
        await page.waitForTimeout(500)
        const grown = await tag()
        assert.ok(
          grown.width > before.width + 10,
          `the tag drew ${grown.width} wide after its padding grew, ${before.width} before: ${await line()}`,
        )
      }
      /** The file states no padding again, and the tag draws at its own width. */
      const handedBack = async (how) => {
        await until(async () => !/padding/.test(await line()))
        await page.waitForTimeout(500)
        const after = await tag()
        assert.ok(
          Math.abs(after.width - before.width) <= 2,
          `after ${how} the tag drew ${after.width} wide, ${before.width} before the scrub`,
        )
      }

      await scrub()
      await page.locator('[data-field="instance-padding"] button.reset').click()
      await handedBack('↺ on Padding')

      await scrub()
      await page.locator('[data-field="overrides"] button.reset-all').click()
      await handedBack('Reset all')

      await scrub()
      await page.evaluate(() => document.activeElement?.blur?.())
      await page.keyboard.press('Control+z')
      await handedBack('undo')
    },
  )

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
