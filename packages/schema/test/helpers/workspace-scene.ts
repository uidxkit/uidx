import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseOrThrow, type UidxDocument, type UidxNode } from '@uidx/format'
import type { SceneNode } from '@open-pencil/scene-graph'
import {
  buildTokenIndex,
  modelIndex,
  resolveTokenValues,
  toSceneGraph,
  TokenResolver,
  type SceneResult,
} from '../../src/index.js'

/**
 * Every page the repo ships, drawn the way the canvas draws it, and the scene
 * flattened to the values a reader can compare.
 *
 * The scene-regression test snapshots these so a change to how instances
 * render shows up as a diff, node by node, and the instance-box work (ADR
 * 0018) reuses the dump to compare a live update or a detach with a rebuild.
 */
const here = dirname(fileURLToPath(import.meta.url))
export const repo = join(here, '../../../..')

/** The documents a set of pages can reach, and which of them to draw. */
export interface Workspace {
  /** Repo-relative paths of the pages to draw, sorted. */
  pages: readonly string[]
  /** Every document the pages may reach, keyed by repo-relative path. */
  docs: ReadonlyMap<string, UidxDocument>
}

/**
 * Git-tracked `.uidx` files under `dir`, repo-relative and sorted. Tracked
 * only, so a scratch page in someone's working copy never joins a snapshot.
 */
function tracked(dir: string): string[] {
  return execFileSync('git', ['ls-files', '--', `${dir}/*.uidx`], { cwd: repo, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .sort()
}

/** Every `.uidx` file in a test fixture folder, tracked or not yet. */
function fixtures(dir: string): string[] {
  return readdirSync(join(repo, dir))
    .filter((file) => file.endsWith('.uidx'))
    .map((file) => relative(repo, join(repo, dir, file)))
    .sort()
}

function load(files: readonly string[]): Map<string, UidxDocument> {
  return new Map(
    files.map((file) => [file, parseOrThrow(readFileSync(join(repo, file), 'utf8'), file)]),
  )
}

/**
 * The four sets of pages: the two examples, the tour fixture, and the
 * instance-box fixture. The last draws instances of the design-system
 * example's components, so that example comes along as its library — its
 * documents are reachable, but its pages are not drawn twice.
 */
export function workspaces(): Workspace[] {
  const design = tracked('examples/design-system/.uidx')
  const box = fixtures('packages/schema/test/fixtures/instance-box')
  return [
    { pages: design, docs: load(design) },
    ...['examples/shoelace/.uidx', 'packages/viewer/test/fixtures/tour'].map((dir) => {
      const files = tracked(dir)
      return { pages: files, docs: load(files) }
    }),
    { pages: box, docs: load([...design, ...box]) },
  ]
}

/** Component name to its definition, across every document — an `<Instance>` is a reference. */
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
 * `doc` built with every resolver the canvas builds with: tokens with their
 * modes, components and models from any document in `docs`. The same set
 * `renderToPng` uses (packages/agent/src/render.ts), plus the model index the
 * canvas passes, so a repeat draws its sample rows.
 */
export function buildPage(docs: ReadonlyMap<string, UidxDocument>, doc: UidxDocument): SceneResult {
  const all = [...docs.values()]
  const index = buildTokenIndex(all)
  const literals = resolveTokenValues(all)
  const components = componentsAcross(all)
  return toSceneGraph(doc, {
    resolveAlias: (address) => literals.get(address),
    resolveComponent: (name) => components.get(name),
    tokens: { resolver: new TokenResolver(index), index },
    models: modelIndex(all),
  })
}

/**
 * One scene node, as much of it as decides what is drawn and where.
 *
 * That is every field the format can write. ADR 0018 sorts each attribute an
 * instance carries into placement, box, cascade or locked, and the render
 * change moves the box and stops drawing the locked, so a field left out here
 * is a regression the snapshot cannot see.
 */
export interface DumpedNode {
  id: string
  type: SceneNode['type']
  name: string
  /** The order the children draw in. A layer that leaks out of a component shows here first. */
  childIds: string[]
  // where it sits
  x: number
  y: number
  width: number
  height: number
  rotation: number
  minWidth: SceneNode['minWidth']
  maxWidth: SceneNode['maxWidth']
  minHeight: SceneNode['minHeight']
  maxHeight: SceneNode['maxHeight']
  horizontalConstraint: SceneNode['horizontalConstraint']
  verticalConstraint: SceneNode['verticalConstraint']
  layoutPositioning: SceneNode['layoutPositioning']
  layoutGrow: number
  layoutAlignSelf: SceneNode['layoutAlignSelf']
  visible: boolean
  locked: boolean
  blendMode: SceneNode['blendMode']
  isMask: boolean
  maskType: SceneNode['maskType']
  // how it lays out what it holds
  layoutMode: SceneNode['layoutMode']
  layoutWrap: SceneNode['layoutWrap']
  primaryAxisSizing: SceneNode['primaryAxisSizing']
  counterAxisSizing: SceneNode['counterAxisSizing']
  primaryAxisAlign: SceneNode['primaryAxisAlign']
  counterAxisAlign: SceneNode['counterAxisAlign']
  counterAxisAlignContent: SceneNode['counterAxisAlignContent']
  itemSpacing: number
  counterAxisSpacing: number
  itemReverseZIndex: boolean
  strokesIncludedInLayout: boolean
  clipsContent: boolean
  paddingTop: number
  paddingRight: number
  paddingBottom: number
  paddingLeft: number
  // how it looks
  fills: SceneNode['fills']
  strokes: SceneNode['strokes']
  borderTopWeight: number
  borderRightWeight: number
  borderBottomWeight: number
  borderLeftWeight: number
  independentStrokeWeights: boolean
  strokeCap: SceneNode['strokeCap']
  strokeJoin: SceneNode['strokeJoin']
  strokeMiterLimit: number
  dashPattern: SceneNode['dashPattern']
  effects: SceneNode['effects']
  opacity: number
  cornerRadius: number
  topLeftRadius: number
  topRightRadius: number
  bottomRightRadius: number
  bottomLeftRadius: number
  independentCorners: boolean
  cornerSmoothing: number
  arcData: SceneNode['arcData']
  /** Marks the build leaves on a node, a slot's today. Preview data must never land here. */
  pluginData: SceneNode['pluginData']
  /** Vector nodes only: a digest, since a network runs to hundreds of characters. */
  vectorNetwork?: string
  /** Text nodes only, from here down. */
  characters?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: number
  italic?: boolean
  lineHeight?: SceneNode['lineHeight']
  letterSpacing?: number
  textAlignHorizontal?: SceneNode['textAlignHorizontal']
  textAlignVertical?: SceneNode['textAlignVertical']
  textAutoResize?: SceneNode['textAutoResize']
  textDirection?: SceneNode['textDirection']
  textCase?: SceneNode['textCase']
  textDecoration?: SceneNode['textDecoration']
  textTruncation?: SceneNode['textTruncation']
  maxLines?: SceneNode['maxLines']
}

/** Geometry to the hundredth: text sizes are estimates, and float noise is not a change. */
const rounded = (value: number): number => Math.round(value * 100) / 100

const digest = (value: unknown): string =>
  createHash('sha256').update(stable(value)).digest('hex').slice(0, 16)

/**
 * Every node of the scene's graph, sorted by id.
 *
 * Every node the file draws has its address as its id. The two the graph
 * provisions for itself — the page and the document above it — are numbered
 * by a counter that runs across builds, so they are named here instead.
 */
export function dumpScene(scene: SceneResult): DumpedNode[] {
  const page = scene.graph.getNode(scene.rootId)
  const named = new Map([
    [scene.rootId, '(page)'],
    ...(page?.parentId ? [[page.parentId, '(document)'] as const] : []),
  ])
  const idOf = (id: string): string => named.get(id) ?? id
  return [...scene.graph.getAllNodes()]
    .map((node): DumpedNode => ({
      id: idOf(node.id),
      type: node.type,
      name: node.name,
      childIds: node.childIds.map(idOf),
      x: rounded(node.x),
      y: rounded(node.y),
      width: rounded(node.width),
      height: rounded(node.height),
      rotation: node.rotation,
      minWidth: node.minWidth,
      maxWidth: node.maxWidth,
      minHeight: node.minHeight,
      maxHeight: node.maxHeight,
      horizontalConstraint: node.horizontalConstraint,
      verticalConstraint: node.verticalConstraint,
      layoutPositioning: node.layoutPositioning,
      layoutGrow: node.layoutGrow,
      layoutAlignSelf: node.layoutAlignSelf,
      visible: node.visible,
      locked: node.locked,
      blendMode: node.blendMode,
      isMask: node.isMask,
      maskType: node.maskType,
      layoutMode: node.layoutMode,
      layoutWrap: node.layoutWrap,
      primaryAxisSizing: node.primaryAxisSizing,
      counterAxisSizing: node.counterAxisSizing,
      primaryAxisAlign: node.primaryAxisAlign,
      counterAxisAlign: node.counterAxisAlign,
      counterAxisAlignContent: node.counterAxisAlignContent,
      itemSpacing: node.itemSpacing,
      counterAxisSpacing: node.counterAxisSpacing,
      itemReverseZIndex: node.itemReverseZIndex,
      strokesIncludedInLayout: node.strokesIncludedInLayout,
      clipsContent: node.clipsContent,
      paddingTop: node.paddingTop,
      paddingRight: node.paddingRight,
      paddingBottom: node.paddingBottom,
      paddingLeft: node.paddingLeft,
      fills: node.fills,
      strokes: node.strokes,
      borderTopWeight: node.borderTopWeight,
      borderRightWeight: node.borderRightWeight,
      borderBottomWeight: node.borderBottomWeight,
      borderLeftWeight: node.borderLeftWeight,
      independentStrokeWeights: node.independentStrokeWeights,
      strokeCap: node.strokeCap,
      strokeJoin: node.strokeJoin,
      strokeMiterLimit: node.strokeMiterLimit,
      dashPattern: node.dashPattern,
      effects: node.effects,
      opacity: node.opacity,
      cornerRadius: node.cornerRadius,
      topLeftRadius: node.topLeftRadius,
      topRightRadius: node.topRightRadius,
      bottomRightRadius: node.bottomRightRadius,
      bottomLeftRadius: node.bottomLeftRadius,
      independentCorners: node.independentCorners,
      cornerSmoothing: node.cornerSmoothing,
      arcData: node.arcData,
      pluginData: node.pluginData,
      ...(node.vectorNetwork ? { vectorNetwork: digest(node.vectorNetwork) } : {}),
      ...(node.type === 'TEXT'
        ? {
            characters: node.text,
            fontSize: node.fontSize,
            fontFamily: node.fontFamily,
            fontWeight: node.fontWeight,
            italic: node.italic,
            lineHeight: node.lineHeight,
            letterSpacing: node.letterSpacing,
            textAlignHorizontal: node.textAlignHorizontal,
            textAlignVertical: node.textAlignVertical,
            textAutoResize: node.textAutoResize,
            textDirection: node.textDirection,
            textCase: node.textCase,
            textDecoration: node.textDecoration,
            textTruncation: node.textTruncation,
            maxLines: node.maxLines,
          }
        : {}),
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

/**
 * Values a node has when nothing set them, left out of a printed line so the
 * line shows what the node actually carries. Fixed here rather than read from
 * the SDK, so an SDK upgrade cannot reword every line at once.
 */
const QUIET: Partial<Record<keyof DumpedNode, unknown>> = {
  childIds: [],
  rotation: 0,
  minWidth: null,
  maxWidth: null,
  minHeight: null,
  maxHeight: null,
  horizontalConstraint: 'MIN',
  verticalConstraint: 'MIN',
  layoutPositioning: 'AUTO',
  layoutGrow: 0,
  layoutAlignSelf: 'AUTO',
  visible: true,
  locked: false,
  blendMode: 'PASS_THROUGH',
  isMask: false,
  maskType: 'ALPHA',
  layoutMode: 'NONE',
  layoutWrap: 'NO_WRAP',
  primaryAxisSizing: 'FIXED',
  counterAxisSizing: 'FIXED',
  primaryAxisAlign: 'MIN',
  counterAxisAlign: 'MIN',
  counterAxisAlignContent: 'AUTO',
  itemSpacing: 0,
  counterAxisSpacing: 0,
  itemReverseZIndex: false,
  strokesIncludedInLayout: false,
  clipsContent: false,
  paddingTop: 0,
  paddingRight: 0,
  paddingBottom: 0,
  paddingLeft: 0,
  fills: [],
  strokes: [],
  borderTopWeight: 0,
  borderRightWeight: 0,
  borderBottomWeight: 0,
  borderLeftWeight: 0,
  independentStrokeWeights: false,
  strokeCap: 'NONE',
  strokeJoin: 'MITER',
  strokeMiterLimit: 4,
  dashPattern: [],
  effects: [],
  opacity: 1,
  cornerRadius: 0,
  topLeftRadius: 0,
  topRightRadius: 0,
  bottomRightRadius: 0,
  bottomLeftRadius: 0,
  independentCorners: false,
  cornerSmoothing: 0,
  arcData: null,
  pluginData: [],
  fontFamily: 'Inter',
  fontWeight: 400,
  italic: false,
  lineHeight: null,
  letterSpacing: 0,
  textAlignHorizontal: 'LEFT',
  textAlignVertical: 'TOP',
  textAutoResize: 'NONE',
  textDirection: 'AUTO',
  textCase: 'ORIGINAL',
  textDecoration: 'NONE',
  textTruncation: 'DISABLED',
  maxLines: null,
}

/** JSON with every object's keys sorted: two paints that differ only in key order print alike. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
}

/** True when `name` is the last segment of `id`, which is how a layer's address ends. */
const saidById = (id: string, name: unknown): boolean => name === id.split(/[#/]/).pop()

/**
 * A dump as text, one node per line: the id, then the values it carries as
 * JSON, with any value at its default (`QUIET`) left out, and the name left
 * out where the id already ends in it. One line each so a snapshot diff names
 * the node on every line it changes, which is how a reviewer checks that only
 * the nodes meant to move did.
 */
export function printScene(nodes: readonly DumpedNode[]): string {
  return nodes
    .map(({ id, ...values }) => {
      const carried = Object.fromEntries(
        Object.entries(values).filter(([key, value]) =>
          key === 'name'
            ? !saidById(id, value)
            : !(key in QUIET) || stable(value) !== stable(QUIET[key as keyof DumpedNode]),
        ),
      )
      return `${id} ${stable(carried)}`
    })
    .join('\n')
}

/**
 * A built page as its snapshot: the dump, then the build's warnings, sorted
 * and one per line, left off when there are none. What a build warns is part
 * of what it does. The render change drops the unknown-property warning for
 * `textFills` and adds one for a locked attribute, and a regression that
 * warned on every instance would otherwise pass unseen.
 */
export function printPage(scene: SceneResult): string {
  const dump = printScene(dumpScene(scene))
  const warnings = [...scene.warnings].sort()
  if (warnings.length === 0) return dump
  return `${dump}\n\nwarnings:\n${warnings.map((warning) => `- ${warning}`).join('\n')}`
}
