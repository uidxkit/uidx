import { readFile } from 'node:fs/promises'
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
