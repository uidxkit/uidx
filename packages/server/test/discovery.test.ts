import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createUidxServer, DISCOVERY_NAME, type UidxServer } from '../src/index.js'

const VALID = `---
id: found
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} />
</Page>
`

let dir: string
let file: string
let server: UidxServer | null = null

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'uidx-discovery-'))
  file = join(dir, 'found.uidx')
  await writeFile(file, VALID)
  await writeFile(join(dir, 'uidx.json'), JSON.stringify({ id: 'doc', files: ['**/*.uidx'] }))
})

afterEach(async () => {
  await server?.close()
  server = null
  await rm(dir, { recursive: true, force: true })
})

describe('server discovery file', () => {
  it('writes port and pid next to the manifest, and removes them on close', async () => {
    server = await createUidxServer({ file, root: dir, port: 4720, stabilityThreshold: 10 })
    const written = JSON.parse(await readFile(join(dir, DISCOVERY_NAME), 'utf8')) as {
      port: number
      url: string
      pid: number
    }
    expect(written.port).toBe(server.port)
    expect(written.url).toBe(server.url)
    expect(written.pid).toBe(process.pid)

    await server.close()
    server = null
    await expect(readFile(join(dir, DISCOVERY_NAME), 'utf8')).rejects.toThrow()
  })

  it('writes nothing when running headless', async () => {
    server = await createUidxServer({ file, stabilityThreshold: 10 })
    await expect(readFile(join(dir, DISCOVERY_NAME), 'utf8')).rejects.toThrow()
  })
})
