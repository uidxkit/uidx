import { readFile } from 'node:fs/promises'
import { dirname, basename, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Only a local npm installation owns the adjacent application's workspace. */
export function installedProject(packageRoot, env = process.env) {
  if (env.npm_config_global === 'true' || env.UIDX_SKIP_INIT === '1') return null
  if (env.npm_command === 'exec') return null
  const parent = dirname(packageRoot)
  const modules = basename(parent).startsWith('@') ? dirname(parent) : parent
  if (basename(modules) !== 'node_modules') return null
  const project = dirname(modules)
  // Skip nested dependencies and package-manager stores. Source checkouts and
  // local directory links also never pass the node_modules check above.
  if (project.split(sep).includes('node_modules')) return null
  return project
}

async function postinstall() {
  const project = installedProject(fileURLToPath(new URL('..', import.meta.url)))
  if (!project) return
  try {
    // Never create a project where there is no application package.json.
    await readFile(join(project, 'package.json'), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  const { initProject } = await import('../dist/index.js')
  await initProject(project)
}

// Setup must not make an otherwise usable dependency impossible to install
// (for example, when the application already has a different `uidx` script).
try {
  await postinstall()
} catch (error) {
  process.stderr.write(
    `uidx: automatic setup was skipped: ${error.message}\nRun npx --no-install uidx init in your project to finish setup.\n`,
  )
}
