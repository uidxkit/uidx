import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

import { fontManager } from '@open-pencil/core'
import { headlessRenderNodes, initCanvasKit } from '@open-pencil/core/io'
import { resolve, type UidxDocument, type UidxNode } from '@uidx/format'
import { buildTokenIndex, resolveTokenValues, toSceneGraph, TokenResolver } from '@uidx/schema'

import { describeNearest } from './address.js'

/** A render that could not happen, said in words the model can act on. */
export class RenderError extends Error {}

export interface RenderRequest {
  /**
   * Every document in the workspace, not just the one being drawn. Three of the
   * four resolvers below answer with something from another file.
   */
  docs: ReadonlyMap<string, UidxDocument>
  file: string
  /** Omit for the whole page. */
  address?: string
  scale?: number
}

const FACES: Record<string, string> = {
  Regular: 'Regular',
  Medium: 'Medium',
  SemiBold: 'Semi Bold',
  Bold: 'Bold',
}

/**
 * Feeds the bundled Inter faces to the SDK's font manager, from the package
 * they ship in rather than over HTTP.
 *
 * `headlessRenderNodes` seeds nothing itself, and an unseeded face is not a
 * cosmetic problem: a codepoint the manager cannot serve raises a font
 * *demand*, and a node whose demand is unsettled renders as nothing at all. The
 * page would come back as its frames with every label missing — which reads as
 * a layout bug and is not one. Web providers are refused outright for the same
 * reason the viewer refuses them: an unreachable provider holds the demand open
 * for as long as the network takes to give up, which offline is indefinitely.
 */
let fonts: Promise<void> | null = null
function seedFonts(): Promise<void> {
  fonts ??= (async () => {
    fontManager.setOnlineFontProviders({
      google: false,
      fontsource: false,
      bunny: false,
      fontshare: false,
    })
    fontManager.setWebFontFetch(() =>
      Promise.reject(new Error('uidx renders offline; web fonts are disabled')),
    )
    const require = createRequire(import.meta.url)
    const assets = join(dirname(require.resolve('@open-pencil/core/package.json')), 'assets')
    for (const [file, style] of Object.entries(FACES)) {
      const bytes = await readFile(join(assets, `Inter-${file}.ttf`))
      fontManager.markLoaded(
        'Inter',
        style,
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      )
    }
  })()
  return fonts
}

/** Booting CanvasKit costs ~100 ms and a 7 MB wasm binary, so it happens once. */
let canvasKit: ReturnType<typeof initCanvasKit> | null = null
function bootRenderer(): ReturnType<typeof initCanvasKit> {
  canvasKit ??= initCanvasKit()
  return canvasKit
}

/** Component name to its definition, across every page — an `<Instance>` is a reference. */
function componentsAcross(docs: readonly UidxDocument[]): Map<string, UidxNode> {
  const components = new Map<string, UidxNode>()
  for (const doc of docs) {
    for (const child of doc.tree.children) {
      const name = child.attrs.name?.value
      if (child.element === 'Component' && typeof name === 'string') components.set(name, child)
    }
  }
  return components
}

/**
 * Draws a page, or one node of it, the way the canvas draws it.
 *
 * The four resolvers are the point. Three of them answer with something from
 * *another file* — a component defined on another page, a token from the scale,
 * an image — which is what separates a correct picture from a plausible one. A
 * render that skipped `buildTokenIndex` would not fail; it would draw every
 * aliased value at its fallback, and the model would go on to "verify" a page
 * the designer will never see. That is worse than no picture at all, and it is
 * the whole reason this reuses the schema package rather than walking the tree
 * itself.
 */
export async function renderToPng(request: RenderRequest): Promise<Uint8Array> {
  const doc = request.docs.get(request.file)
  if (!doc) {
    const known = [...request.docs.keys()].sort().join(', ')
    throw new RenderError(`no such page: ${request.file}. Pages: ${known}`)
  }
  if (doc.tree.element === 'Tokens') {
    throw new RenderError(
      `${request.file} declares variable collections, not a scene — nothing to draw`,
    )
  }

  const all = [...request.docs.values()]
  const index = buildTokenIndex(all)
  const literals = resolveTokenValues(all)
  const components = componentsAcross(all)

  const scene = toSceneGraph(doc, {
    resolveAlias: (address) => literals.get(address),
    resolveComponent: (name) => components.get(name),
    tokens: { resolver: new TokenResolver(index), index },
  })

  const target = request.address ?? ''
  if (target !== '' && !resolve(doc.tree, target)) {
    throw new RenderError(
      `no node at address ${JSON.stringify(target)} on ${request.file}${describeNearest(doc, target)}`,
    )
  }
  // `headlessRenderNodes` draws a selection *within* a page, so the page
  // itself is not a thing it can be handed — asked to draw one it answers
  // "raster export selection must stay on a single page". Drawing the whole
  // page means drawing everything on it, which is its top-level nodes.
  const sceneIds =
    target === ''
      ? doc.tree.children
          .map((child) => scene.addresses.sceneIdOf(child.address))
          .filter((id): id is string => id !== undefined)
      : [scene.addresses.sceneIdOf(target)].filter((id): id is string => id !== undefined)
  if (sceneIds.length === 0) {
    const what = target === '' ? request.file : `${target} on ${request.file}`
    throw new RenderError(`${what} draws nothing — the page is empty`)
  }

  await seedFonts()
  await bootRenderer()

  const pageId = scene.graph.getPages()[0]?.id
  if (!pageId) throw new RenderError('the scene graph has no page to draw')

  // The SDK is entitled to throw, and what it throws is not a `RenderError` —
  // so without this, a page it cannot draw ends the whole turn instead of
  // coming back as words. Measured: a page carrying
  // `<Text characters="{radius#pill}" />` resolved that alias to the number
  // 999, and the font pass — which walks the entire graph before anything is
  // drawn, so one bad node stops every render — threw "text is not iterable".
  // `badAliases` names that specific cause at the moment it is authored; this
  // is the net under every cause nobody has met yet.
  let bytes: Uint8Array | null
  try {
    bytes = await headlessRenderNodes(scene.graph, pageId, sceneIds, {
      scale: request.scale ?? 1,
      format: 'PNG',
    })
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    throw new RenderError(
      `${request.file} could not be drawn: ${why}. Something on the page is not what its prop expects — a token alias substituted into a text, or a value of the wrong kind.`,
    )
  }
  if (!bytes) throw new RenderError(`nothing was drawn for ${request.file}`)
  return bytes
}

/** Test seam: the module-level caches would otherwise leak between cases. */
export function resetRenderer(): void {
  fonts = null
  canvasKit = null
}
