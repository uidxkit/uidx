import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import type { FoundManifest } from './document.js'

export const FONT_ROUTE = '/__uidx/fonts'
const MAX_BYTES = 20 * 1024 * 1024
const WEIGHTS = [
  'Thin',
  'Extra Light',
  'Light',
  'Regular',
  'Medium',
  'Semi Bold',
  'Bold',
  'Extra Bold',
  'Black',
]
const hasControlCharacters = (value: string): boolean =>
  Array.from(value).some((char) => char.charCodeAt(0) < 32)

export interface ProjectFont {
  id: string
  family: string
  style: string
  weight: number
  italic: boolean
  source: 'google' | 'custom'
  file: string
}

/** Read real font metadata, never trust a filename or a client-supplied family. */
export function inspectFont(bytes: Uint8Array): Omit<ProjectFont, 'id' | 'source' | 'file'> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const invalid = (): never => {
    throw new Error('Choose a valid static .ttf or .otf font file.')
  }
  if (bytes.length < 12 || bytes.length > MAX_BYTES) return invalid()
  if (![0x00010000, 0x4f54544f, 0x74727565].includes(view.getUint32(0))) return invalid()
  const tables = new Map<string, { offset: number; length: number }>()
  const count = view.getUint16(4)
  if (12 + count * 16 > bytes.length) return invalid()
  for (let i = 0; i < count; i++) {
    const at = 12 + i * 16
    const tag = String.fromCharCode(...bytes.subarray(at, at + 4))
    const offset = view.getUint32(at + 8),
      length = view.getUint32(at + 12)
    if (offset + length > bytes.length) return invalid()
    tables.set(tag, { offset, length })
  }
  if (tables.has('fvar'))
    throw new Error(
      'Variable font files are not supported yet. Upload static TTF or OTF styles, or import the style from Google Fonts.',
    )
  for (const tag of ['name', 'head', 'cmap', 'maxp', 'hhea', 'hmtx'])
    if (!tables.has(tag)) return invalid()
  if (!tables.has('glyf') && !tables.has('CFF ')) return invalid()
  const name = tables.get('name')!
  if (name.length < 6) return invalid()
  const names = new Map<number, { value: string; score: number }>()
  const records = view.getUint16(name.offset + 2),
    strings = view.getUint16(name.offset + 4)
  if (6 + records * 12 > name.length) return invalid()
  for (let i = 0; i < records; i++) {
    const at = name.offset + 6 + i * 12
    const platform = view.getUint16(at),
      language = view.getUint16(at + 4),
      id = view.getUint16(at + 6)
    if (![1, 16].includes(id) || ![0, 1, 3].includes(platform)) continue
    const length = view.getUint16(at + 8),
      offset = strings + view.getUint16(at + 10)
    if (offset + length > name.length) return invalid()
    const raw = bytes.subarray(name.offset + offset, name.offset + offset + length)
    const value = new TextDecoder(platform === 1 ? 'macintosh' : 'utf-16be')
      .decode(raw)
      .replaceAll('\0', '')
      .trim()
    const score = (platform === 3 ? 2 : platform === 0 ? 1 : 0) + (language === 0x409 ? 2 : 0)
    if (value && (!names.has(id) || score > names.get(id)!.score)) names.set(id, { value, score })
  }
  const family = names.get(16)?.value ?? names.get(1)?.value
  if (!family || family.length > 200 || hasControlCharacters(family)) return invalid()
  const os2 = tables.get('OS/2'),
    head = tables.get('head')!
  if (head.length < 46) return invalid()
  const weight = os2 && os2.length >= 6 ? view.getUint16(os2.offset + 4) : 400
  if (weight < 1 || weight > 1000) return invalid()
  const italic =
    os2 && os2.length >= 64
      ? Boolean(view.getUint16(os2.offset + 62) & 1)
      : Boolean(view.getUint16(head.offset + 44) & 2)
  const label = WEIGHTS[Math.max(0, Math.min(8, Math.round(weight / 100) - 1))]!
  return {
    family,
    weight,
    italic,
    style: italic ? (label === 'Regular' ? 'Italic' : `${label} Italic`) : label,
  }
}

/** Project-owned files; the generated ids are also the only readable paths. */
export class FontLibrary {
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly dir: string) {}

  private async directory(): Promise<string> {
    const dir = join(this.dir, 'fonts')
    await mkdir(dir, { recursive: true })
    if ((await lstat(dir)).isSymbolicLink())
      throw new Error('The project fonts directory must not be a symlink.')
    return dir
  }

  async list(): Promise<ProjectFont[]> {
    try {
      const path = join(await this.directory(), 'fonts.json')
      if ((await lstat(path)).isSymbolicLink()) throw new Error('Font index must not be a symlink.')
      const value: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (!Array.isArray(value) || !value.every(isProjectFont))
        throw new Error('Invalid fonts/fonts.json.')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  private async save(fonts: ProjectFont[]): Promise<void> {
    const dir = await this.directory(),
      temporary = join(dir, `${randomUUID()}.tmp`)
    await writeFile(temporary, `${JSON.stringify(fonts, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, join(dir, 'fonts.json'))
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work)
    this.queue = result.catch(() => undefined)
    return result
  }

  add(bytes: Uint8Array, source: ProjectFont['source'], family?: string): Promise<ProjectFont> {
    return this.serialize(async () => {
      const info = inspectFont(bytes)
      // Google's static instances sometimes use a weight-specific internal family.
      if (family) info.family = family
      const id = createHash('sha256').update(bytes).update(info.family).digest('hex')
      const font = {
        ...info,
        id,
        source,
        file: `${id}.${new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === 0x4f54544f ? 'otf' : 'ttf'}`,
      }
      const fonts = await this.list()
      const duplicate = fonts.find(
        (entry) =>
          entry.family.toLowerCase() === info.family.toLowerCase() &&
          entry.weight === info.weight &&
          entry.italic === info.italic,
      )
      if (duplicate) {
        if (duplicate.id === id) return duplicate
        throw new Error(
          `${info.family} ${info.style} is already imported. Remove it before importing a different file for that style.`,
        )
      }
      if (
        info.family.toLowerCase() === 'inter' &&
        !info.italic &&
        [400, 500, 600, 700].includes(info.weight)
      )
        throw new Error(`Inter ${info.style} is already bundled with uidx.`)
      await writeFile(join(await this.directory(), font.file), bytes, { flag: 'wx' }).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error
        },
      )
      await this.save([...fonts, font])
      return font
    })
  }

  async bytes(id: string): Promise<Buffer> {
    const font = (await this.list()).find((entry) => entry.id === id)
    if (!font) throw new Error('Font not found.')
    const path = join(await this.directory(), font.file)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Font files must not be symlinks.')
    return readFile(path)
  }

  remove(id: string): Promise<void> {
    return this.serialize(async () => {
      const fonts = await this.list(),
        font = fonts.find((entry) => entry.id === id)
      if (!font) throw new Error('Font not found.')
      await this.save(fonts.filter((entry) => entry.id !== id))
      await unlink(join(await this.directory(), font.file)).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        },
      )
    })
  }
}

function isProjectFont(value: unknown): value is ProjectFont {
  if (!value || typeof value !== 'object') return false
  const f = value as ProjectFont
  return (
    typeof f.id === 'string' &&
    /^[a-f0-9]{64}$/.test(f.id) &&
    [f.id + '.ttf', f.id + '.otf'].includes(f.file) &&
    typeof f.family === 'string' &&
    typeof f.style === 'string' &&
    typeof f.weight === 'number' &&
    typeof f.italic === 'boolean' &&
    ['google', 'custom'].includes(f.source)
  )
}

async function limitedBody(body: AsyncIterable<Uint8Array>, limit = MAX_BYTES): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of body) {
    length += chunk.length
    if (length > limit) throw new Error('Font files must be smaller than 20 MB.')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function downloadGoogleFont(
  family: string,
  weight: number,
  italic: boolean,
): Promise<Uint8Array> {
  if (
    !family.trim() ||
    family.length > 200 ||
    /[:@;&]/.test(family) ||
    hasControlCharacters(family) ||
    !Number.isInteger(weight) ||
    weight < 100 ||
    weight > 900
  )
    throw new Error('Enter a Google font family and a weight from 100 to 900.')
  const url = new URL('https://fonts.googleapis.com/css2')
  url.searchParams.set('family', `${family.trim()}:ital,wght@${italic ? 1 : 0},${weight}`)
  // A legacy UA requests one complete static TrueType face, not browser-specific
  // WOFF subsets or variable files that CanvasKit cannot reliably shape.
  const css = await fetch(url, {
    headers: { 'user-agent': 'uidx-font-import/1.0' },
    signal: AbortSignal.timeout(20_000),
    redirect: 'error',
  })
  if (!css.ok)
    throw new Error(
      'Google Fonts could not find that family and style. Check the family name and try another weight.',
    )
  const source = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(
    (await limitedBody(css.body! as unknown as AsyncIterable<Uint8Array>, 1024 * 1024)).toString(),
  )?.[1]
  if (!source || new URL(source).hostname !== 'fonts.gstatic.com')
    throw new Error('Google Fonts did not return a supported font file.')
  const response = await fetch(source, { signal: AbortSignal.timeout(20_000), redirect: 'error' })
  if (!response.ok || !response.body)
    throw new Error('The Google font download failed. Please try again.')
  return limitedBody(response.body as unknown as AsyncIterable<Uint8Array>)
}

export function fontRoutePlugin(manifest: { current: FoundManifest | null }): Plugin {
  let library: FontLibrary | undefined
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    response.setHeader('cache-control', 'no-store')
    response.setHeader('content-type', 'application/json')
    if (!manifest.current) {
      response.statusCode = 404
      response.end(JSON.stringify({ error: 'Open a uidx project to manage fonts.' }))
      return
    }
    library ??= new FontLibrary(manifest.current.dir)
    const path = (request.url ?? '/').split('?')[0]!
    try {
      const origin = request.headers.origin
      if (
        request.method !== 'GET' &&
        (request.headers['sec-fetch-site'] === 'cross-site' ||
          (origin && new URL(origin).host !== request.headers.host))
      ) {
        response.statusCode = 403
        response.end(JSON.stringify({ error: 'Font changes must come from this viewer.' }))
        return
      }
      if (request.method === 'GET' && path === '/')
        response.end(JSON.stringify(await library.list()))
      else if (request.method === 'GET' && /^\/[a-f0-9]{64}$/.test(path)) {
        const bytes = await library.bytes(path.slice(1))
        response.setHeader(
          'content-type',
          bytes.readUInt32BE(0) === 0x4f54544f ? 'font/otf' : 'font/ttf',
        )
        response.end(bytes)
      } else if (request.method === 'POST' && path === '/upload') {
        response.end(JSON.stringify(await library.add(await limitedBody(request), 'custom')))
      } else if (request.method === 'POST' && path === '/google') {
        const input = JSON.parse((await limitedBody(request, 4096)).toString()) as {
          family: unknown
          weight: unknown
          italic: unknown
        }
        if (
          typeof input.family !== 'string' ||
          typeof input.weight !== 'number' ||
          typeof input.italic !== 'boolean'
        )
          throw new Error('Enter a Google font family, weight, and style.')
        response.end(
          JSON.stringify(
            await library.add(
              await downloadGoogleFont(input.family, input.weight, input.italic),
              'google',
              input.family.trim(),
            ),
          ),
        )
      } else if (request.method === 'DELETE' && /^\/[a-f0-9]{64}$/.test(path)) {
        await library.remove(path.slice(1))
        response.end(JSON.stringify({ ok: true }))
      } else {
        response.statusCode = 404
        response.end(JSON.stringify({ error: 'Font route not found.' }))
      }
    } catch (error) {
      response.statusCode = 400
      response.end(
        JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to load font.' }),
      )
    }
  }
  const configure = (server: Pick<ViteDevServer, 'middlewares'>): void => {
    server.middlewares.use(FONT_ROUTE, (req, res) => {
      void handle(req, res)
    })
  }
  return { name: 'uidx:fonts', configureServer: configure, configurePreviewServer: configure }
}
