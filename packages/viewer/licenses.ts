import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const root = fileURLToPath(new URL('../..', import.meta.url))
const licenseDir = join(root, 'third-party/licenses')

/** Preserve the notices for dependencies actually embedded in the browser build. */
export function thirdPartyNotices(): Plugin {
  return {
    name: 'uidx:third-party-notices',
    async generateBundle(_options, bundle) {
      const packages = new Map<
        string,
        { dir: string; name: string; version: string; license?: string }
      >()
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (!module.renderedLength || !id.includes('/node_modules/')) continue
          let dir = dirname(id.replace(/^\0/, '').split('?')[0]!)
          while (dir !== dirname(dir)) {
            try {
              const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
              if (pkg.name && pkg.version) {
                packages.set(`${pkg.name}@${pkg.version}`, { ...pkg, dir })
                break
              }
            } catch {
              /* Some module directories do not contain a manifest. */
            }
            dir = dirname(dir)
          }
        }
      }
      const sections = [
        'Third-party code included in the uidx viewer. Each component retains its own license.',
      ]
      for (const [key, pkg] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
        const files = (await readdir(pkg.dir)).filter((name) =>
          /^(licen[cs]e|copying|notice)([._-]|$)/i.test(name),
        )
        const texts = await Promise.all(files.map((name) => readFile(join(pkg.dir, name), 'utf8')))
        if (!texts.length && pkg.name.startsWith('@open-pencil/')) {
          texts.push(await readFile(join(licenseDir, 'open-pencil-MIT.txt'), 'utf8'))
          if (pkg.name === '@open-pencil/yoga-layout')
            texts.push(await readFile(join(licenseDir, 'yoga-MIT.txt'), 'utf8'))
        }
        if (!texts.length && pkg.name === '@ai-sdk/provider-utils') {
          texts.push(await readFile(join(licenseDir, 'AI-SDK-Apache-notice.txt'), 'utf8'))
        }
        if (!texts.length && pkg.name === 'stackblur-canvas') {
          texts.push(await readFile(join(licenseDir, 'StackBlur-MIT.txt'), 'utf8'))
        }
        if (!texts.length && pkg.name === 'format') {
          texts.push(await readFile(join(licenseDir, 'format-MIT.txt'), 'utf8'))
        }
        if (!texts.length) {
          try {
            const readme = await readFile(join(pkg.dir, 'README.md'), 'utf8')
            const license = readme.match(/(?:^|\n)#+\s+licen[cs]e[^\n]*\n([\s\S]*)/i)?.[1]
            if (license?.includes('Permission is hereby granted')) texts.push(license)
          } catch {
            /* Missing notices are a build error below. */
          }
        }
        if (!texts.length) throw new Error(`Missing third-party license text for ${key}`)
        sections.push(`${key} (${pkg.license ?? 'see license below'})\n${texts.join('\n\n')}`)
      }
      for (const name of [
        'Inter-OFL.txt',
        'NotoNaskhArabic-OFL.txt',
        'CanvasKit-BSD.txt',
        'Apache-2.0.txt',
      ]) {
        sections.push(`${name}\n${await readFile(resolve(licenseDir, name), 'utf8')}`)
      }
      this.emitFile({
        type: 'asset',
        fileName: 'third-party-notices.txt',
        source: sections.join('\n\n----------------------------------------\n\n'),
      })
    },
  }
}
