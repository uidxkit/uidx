import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

const exec = promisify(execFile)

describe('installation scope', () => {
  it('only initializes a local consumer, skipping global installs, npx, links and opt-outs', async () => {
    const script = new URL('../scripts/postinstall.mjs', import.meta.url).href
    const { stdout, stderr } = await exec(process.execPath, [
      '--input-type=module',
      '-e',
      `import { installedProject } from ${JSON.stringify(script)};
       import { resolve } from 'node:path';
       const root = resolve('consumer');
       const pkg = resolve(root, 'node_modules/@uidxkit/uidx');
       process.stdout.write(JSON.stringify([
         installedProject(pkg, {}),
         installedProject(pkg, { npm_config_global: 'true' }),
         installedProject(pkg, { npm_command: 'exec' }),
         installedProject(pkg, { UIDX_SKIP_INIT: '1' }),
         installedProject(resolve(root, 'packages/cli'), {}),
         installedProject(resolve(root, 'node_modules/other/node_modules/@uidxkit/uidx'), {}),
         installedProject(resolve(root, 'node_modules/.pnpm/@uidxkit+uidx/node_modules/@uidxkit/uidx'), {}),
       ]));`,
    ])
    expect(stderr).toBe('')
    const roots = JSON.parse(stdout)
    expect(roots[0]).toMatch(/consumer$/)
    expect(roots.slice(1)).toEqual([null, null, null, null, null, null])
  })
})
