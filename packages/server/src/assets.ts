import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { assetPathProblem } from '@uidx/format'

import { documentAssets, type FoundManifest } from './document.js'

/**
 * Serving the bytes an image reference names (ADR 0006 §9).
 *
 * The renderer is in a browser and the artwork is on disk, so something has to
 * bridge them. The server already speaks to the viewer and already knows the
 * manifest, so it gains one route rather than the socket gaining a second job:
 * pushing bytes down `file:changed` would re-send a logo on every save and
 * forfeit the browser cache an HTTP route gets for nothing.
 *
 * The resolution happening **here** is the point. A path check that only ran in
 * the browser would be a suggestion; running it on the server, once, against
 * the globs the document declared, is what makes it enforceable — a `..` that
 * slipped past the client still cannot read a file the document never named.
 */
export const ASSET_ROUTE = '/__uidx/asset/'

/** What the route should answer with, decided without touching the socket. */
export type AssetReply =
  { status: 200; body: Uint8Array; type: string } | { status: 400 | 403 | 404; message: string }

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
}

/** By extension, because the bytes are handed to a decoder that sniffs anyway. */
export function contentTypeFor(src: string): string {
  const ext = src.slice(src.lastIndexOf('.') + 1).toLowerCase()
  return TYPES[ext] ?? 'application/octet-stream'
}

/**
 * The reply for one asset request.
 *
 * Split from the middleware so the decisions — malformed, undeclared, missing —
 * are testable without an HTTP server, which is the same reason `check`'s
 * asset pass is a function rather than a print.
 */
export async function assetReply(found: FoundManifest, rawPath: string): Promise<AssetReply> {
  let src: string
  try {
    src = decodeURIComponent(rawPath)
  } catch {
    return { status: 400, message: 'that is not a readable path' }
  }

  const malformed = assetPathProblem(src)
  if (malformed) return { status: 400, message: malformed }

  // Membership in the declared set, not a prefix test: the manifest's globs are
  // the document's own statement about what belongs to it, and enumerating them
  // is the only reading of that statement this package can make exactly.
  const declared = await documentAssets(found)
  if (!declared.has(src)) {
    return { status: 403, message: `"${src}" is not declared by "assets" in uidx.json` }
  }

  try {
    return { status: 200, body: await readFile(resolve(found.dir, src)), type: contentTypeFor(src) }
  } catch {
    return { status: 404, message: `"${src}" does not exist` }
  }
}

/** Raster formats an upload may be; SVG is imported as vectors instead. */
const RASTER = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])
export const MAX_UPLOAD = 20 * 1024 * 1024

/**
 * Saves dropped artwork into the document's assets folder (ADR 0006 §9) and
 * answers with the `src` an image fill names it by. The folder is the first
 * `assets` pattern's fixed prefix (`assets/**` → `assets/`), so the file is
 * declared the moment it lands; a project that declares no assets is told to.
 * The same bytes dropped twice reuse one file.
 */
export async function saveAsset(
  found: FoundManifest,
  fileName: string,
  bytes: Uint8Array,
): Promise<{ src: string }> {
  const pattern = found.manifest.assets.find((glob) => !glob.startsWith('!'))
  if (!pattern)
    throw new Error(
      'Declare an assets folder in uidx.json ("assets": ["assets/**"]) to add images.',
    )
  const folder = pattern
    .split('/')
    .filter((part) => !/[*?[{]/.test(part))
    .join('/')
  const dot = fileName.lastIndexOf('.')
  const ext = fileName.slice(dot + 1).toLowerCase()
  if (dot === -1 || !RASTER.has(ext)) throw new Error('Drop a PNG, JPEG, GIF, WebP or AVIF image.')
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD)
    throw new Error('An image must be between 1 byte and 20 MB.')
  const stem =
    fileName
      .slice(0, dot)
      .normalize('NFKD')
      .replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'image'
  const digest = createHash('sha256').update(bytes).digest('hex')
  await mkdir(resolve(found.dir, folder || '.'), { recursive: true })
  for (let n = 1; n < 1000; n++) {
    const name = n === 1 ? `${stem}.${ext}` : `${stem}-${n}.${ext}`
    const src = folder ? `${folder}/${name}` : name
    const path = resolve(found.dir, src)
    try {
      const existing = await readFile(path)
      if (createHash('sha256').update(existing).digest('hex') === digest) return { src }
    } catch {
      await writeFile(path, bytes, { flag: 'wx' })
      return { src }
    }
  }
  throw new Error('Too many images share that name.')
}
