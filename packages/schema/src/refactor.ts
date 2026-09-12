import {
  aliasTarget,
  isAlias,
  toAlias,
  type JsonValue,
  type UidxDocument,
  type UidxNode,
  type UidxPatch,
} from '@uidx/format'

import type { Dependent, DependentsIndex } from './symbol-deps.js'
import { defaultTuple, mergeModes, tupleAt, TokenResolver } from './resolve-modes.js'
import type { TokenIndex } from './token-index.js'

/**
 * The document refactor engine (spec §13): pure functions from documents to
 * patches, one per affected file. The tokens view and the component flows
 * both dispatch these — the viewer only carries envelopes.
 *
 * Batch order is the safety argument. Within the declaring file, reference
 * rewrites come before the declaration change, so an interruption between
 * files leaves either old-name references to an old-name declaration (the
 * rename simply has not happened there yet) or rewritten literals — never a
 * dangling reference the renderer must guess about. Cross-file batches are
 * not one transaction; the caller re-checks after dispatch and reports
 * stragglers, which surface as visible broken-reference findings.
 */
export interface RefactorPlan {
  /** file → ordered patches. The declaring file's batch includes the rename itself. */
  byFile: ReadonlyMap<string, readonly UidxPatch[]>
  /** For the blast-radius UI. */
  dependents: readonly Dependent[]
}

export function renameToken(
  pages: ReadonlyMap<string, UidxDocument>,
  deps: DependentsIndex,
  address: string,
  newName: string,
): RefactorPlan {
  const declaringFile = fileDeclaringToken(pages, address)
  if (declaringFile === null) {
    throw new Error(`no <Variable> at ${JSON.stringify(address)} in this document`)
  }
  const collection = address.slice(0, address.indexOf('#'))
  const newAlias = toAlias(`${collection}#${newName}`)
  const dependents = deps.ofToken.get(address) ?? []

  const byFile = new Map<string, UidxPatch[]>()
  const batchFor = (file: string): UidxPatch[] => {
    const existing = byFile.get(file)
    if (existing) return existing
    const fresh: UidxPatch[] = []
    byFile.set(file, fresh)
    return fresh
  }

  for (const dependent of dependents) {
    batchFor(dependent.file).push(rewritePatch(pages, dependent, address, newAlias))
  }
  // The declaration moves last in its file: references first, then the name.
  batchFor(declaringFile).push({ op: 'set', address, prop: 'name', value: newName })

  return { byFile, dependents }
}

export interface DeletePlan extends RefactorPlan {
  /**
   * Dependents whose slot holds one value where the deleted token held
   * several — inlining freezes them to what they currently show. The confirm
   * dialog warns on exactly these.
   */
  flattened: readonly Dependent[]
  /**
   * The file holding the declaration. Its batch ends with the removal, so a
   * caller dispatching several files sends this one LAST — an interruption
   * then leaves extra literals, never a reference to a variable already gone.
   */
  declaringFile: string
}

/**
 * Rewrites every first-level dependent to the literal it currently resolves
 * to, then removes the declaration (spec §11) — so deleting a token never
 * changes what a page draws.
 */
export function deleteToken(
  pages: ReadonlyMap<string, UidxDocument>,
  index: TokenIndex,
  deps: DependentsIndex,
  address: string,
): DeletePlan {
  const declaringFile = fileDeclaringToken(pages, address)
  if (declaringFile === null) {
    throw new Error(`no <Variable> at ${JSON.stringify(address)} in this document`)
  }
  return deleteDeclarations(pages, index, deps, [address], declaringFile, address)
}

export interface DeleteCollectionPlan extends DeletePlan {
  tokens: readonly string[]
  modeOverrides: number
}

/** Remove a collection as one declaration, preserving references outside it. */
export function deleteCollection(
  pages: ReadonlyMap<string, UidxDocument>,
  index: TokenIndex,
  deps: DependentsIndex,
  name: string,
): DeleteCollectionPlan {
  for (const [file, doc] of pages) {
    if (doc.tree.element !== 'Tokens') continue
    const collection = doc.tree.children.find(
      (node) => node.element === 'Collection' && node.name === name,
    )
    if (!collection) continue
    const tokens = collection.children
      .filter((node) => node.element === 'Variable')
      .map((node) => node.address)
    return {
      ...deleteDeclarations(pages, index, deps, tokens, file, collection.address, name),
      tokens,
    }
  }
  throw new Error(`no collection named ${JSON.stringify(name)} in this document`)
}

function dependentKey(dependent: Dependent): string {
  return JSON.stringify([dependent.file, dependent.address, dependent.prop, dependent.mode])
}

function deleteDeclarations(
  pages: ReadonlyMap<string, UidxDocument>,
  index: TokenIndex,
  deps: DependentsIndex,
  addresses: readonly string[],
  declaringFile: string,
  declaration: string,
  collection?: string,
): DeletePlan & { modeOverrides: number } {
  const resolver = new TokenResolver(index)
  const base = defaultTuple(index)
  const removed = new Set(addresses)
  const dependents = new Map<string, Dependent>()
  const flattened = new Map<string, Dependent>()
  const rewrites = new Map<string, { dependent: Dependent; patch: UidxPatch }>()
  const byFile = new Map<string, UidxPatch[]>()
  const batchFor = (file: string): UidxPatch[] => {
    const existing = byFile.get(file)
    if (existing) return existing
    const fresh: UidxPatch[] = []
    byFile.set(file, fresh)
    return fresh
  }

  for (const address of addresses) {
    const entry = index.entries.get(address)
    const moded =
      entry !== undefined &&
      new Set(Object.values(entry.valuesByMode).map((v) => JSON.stringify(v))).size > 1
    for (const dependent of deps.ofToken.get(address) ?? []) {
      if (
        collection &&
        dependent.file === declaringFile &&
        removed.has(dependent.address) &&
        (dependent.kind === 'variable' || dependent.kind === 'mode')
      )
        continue
      // The literal this dependent currently shows. A mode child resolves under
      // its own collection's mode (so brand.dark inlines the dark answer); a
      // scene attr resolves under the tuple in force at its node; a plain
      // variable resolves under the default tuple.
      const tuple =
        dependent.kind === 'mode'
          ? mergeModes(base, { [collectionOf(dependent.address)]: dependent.mode! }, index)
          : dependent.kind === 'scene'
            ? tupleAt(pages.get(dependent.file)!.tree, dependent.address, index)
            : base
      const literal = resolver.resolve(tuple).get(address)
      if (literal === undefined) {
        throw new Error(
          `${JSON.stringify(address)} does not resolve to a literal; ` +
            'fix the broken chain before deleting it',
        )
      }
      const key = dependentKey(dependent)
      const previous = rewrites.get(key)?.patch
      // Several tokens may share a fills/props array. Accumulate replacements
      // into that one attribute rather than overwriting an earlier replacement.
      const patch =
        previous?.op === 'set'
          ? { ...previous, value: rewriteAliases(previous.value, address, literal) }
          : rewritePatch(pages, dependent, address, literal)
      rewrites.set(key, { dependent, patch })
      dependents.set(key, dependent)
      // A mode child keeps per-mode answers; every single-slot dependent
      // flattens a moded token.
      if (moded && dependent.kind !== 'mode') flattened.set(key, dependent)
    }
  }
  for (const { dependent, patch } of rewrites.values()) batchFor(dependent.file).push(patch)
  let modeOverrides = 0
  if (collection) {
    for (const [file, doc] of pages) {
      if (doc.tree.element === 'Tokens') continue
      const walk = (node: UidxNode): void => {
        const modes = node.attrs.modes?.value
        if (
          modes &&
          typeof modes === 'object' &&
          !Array.isArray(modes) &&
          Object.hasOwn(modes, collection)
        ) {
          const remaining = Object.fromEntries(
            Object.entries(modes).filter(([name]) => name !== collection),
          )
          batchFor(file).push(
            Object.keys(remaining).length
              ? { op: 'set', address: node.address, prop: 'modes', value: remaining }
              : { op: 'remove', address: node.address, prop: 'modes' },
          )
          modeOverrides += 1
        }
        node.children.forEach(walk)
      }
      walk(doc.tree)
    }
  }
  batchFor(declaringFile).push({ op: 'remove-node', address: declaration })
  return {
    byFile,
    dependents: [...dependents.values()],
    flattened: [...flattened.values()],
    declaringFile,
    modeOverrides,
  }
}

function collectionOf(address: string): string {
  return address.slice(0, address.indexOf('#'))
}

/**
 * Components are the namespace's other half (ADR 0004), and rename is the
 * same verb: repoint every reference, then change the name. Exact matches
 * only — `Card` must never drag `CardHeader` along.
 */
export function renameComponent(
  pages: ReadonlyMap<string, UidxDocument>,
  deps: DependentsIndex,
  name: string,
  newName: string,
): RefactorPlan {
  const declaringFile = fileDeclaringComponent(pages, name)
  if (declaringFile === null) {
    throw new Error(`no <Component> named ${JSON.stringify(name)} in this document`)
  }
  const dependents = deps.ofComponent.get(name) ?? []

  const byFile = new Map<string, UidxPatch[]>()
  const batchFor = (file: string): UidxPatch[] => {
    const existing = byFile.get(file)
    if (existing) return existing
    const fresh: UidxPatch[] = []
    byFile.set(file, fresh)
    return fresh
  }

  for (const dependent of dependents) {
    if (dependent.kind === 'instance') {
      batchFor(dependent.file).push({
        op: 'set',
        address: dependent.address,
        prop: 'component',
        value: newName,
      })
      continue
    }
    // instance-swap: the name hides inside the props object; clone around it.
    const node = findByAddress(pages.get(dependent.file)!, dependent.address)
    const current = node?.attrs[dependent.prop]?.value
    if (current === undefined) {
      throw new Error(
        `dependent ${dependent.address}.${dependent.prop} in ${dependent.file} no longer exists`,
      )
    }
    batchFor(dependent.file).push({
      op: 'set',
      address: dependent.address,
      prop: dependent.prop,
      value: rewriteStrings(current, name, newName),
    })
  }

  batchFor(declaringFile).push({ op: 'set', address: name, prop: 'name', value: newName })
  return { byFile, dependents }
}

/** Clones a JsonValue replacing exact string matches — for names, not aliases. */
function rewriteStrings(value: JsonValue, from: string, to: string): JsonValue {
  if (value === from) return to
  if (Array.isArray(value)) return value.map((item) => rewriteStrings(item, from, to))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteStrings(item, from, to)]),
    )
  }
  return value
}

function fileDeclaringComponent(
  pages: ReadonlyMap<string, UidxDocument>,
  name: string,
): string | null {
  for (const [file, doc] of pages) {
    let found = false
    const walk = (node: (typeof doc)['tree']): void => {
      if (found) return
      if (node.element === 'Component' && node.name === name) {
        found = true
        return
      }
      for (const child of node.children) walk(child)
    }
    walk(doc.tree)
    if (found) return file
  }
  return null
}

/** The patch that repoints one dependent at `replacement` (an alias or a literal). */
function rewritePatch(
  pages: ReadonlyMap<string, UidxDocument>,
  dependent: Dependent,
  from: string,
  replacement: JsonValue,
): UidxPatch {
  if (dependent.kind === 'mode') {
    return {
      op: 'set-mode',
      address: dependent.address,
      mode: dependent.mode!,
      value: replacement,
    }
  }
  const doc = pages.get(dependent.file)
  const node = doc ? findByAddress(doc, dependent.address) : null
  const current = node?.attrs[dependent.prop]?.value
  if (current === undefined) {
    throw new Error(
      `dependent ${dependent.address}.${dependent.prop} in ${dependent.file} no longer exists`,
    )
  }
  return {
    op: 'set',
    address: dependent.address,
    prop: dependent.prop,
    value: rewriteAliases(current, from, replacement),
  }
}

/**
 * Clones a JsonValue with every alias to `from` replaced — and nothing else
 * touched, so a `fills` array keeps its unrelated entries byte-for-byte.
 */
export function rewriteAliases(value: JsonValue, from: string, replacement: JsonValue): JsonValue {
  if (isAlias(value) && aliasTarget(value) === from) return replacement
  if (Array.isArray(value)) return value.map((item) => rewriteAliases(item, from, replacement))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, rewriteAliases(item, from, replacement)]),
    )
  }
  return value
}

function fileDeclaringToken(
  pages: ReadonlyMap<string, UidxDocument>,
  address: string,
): string | null {
  for (const [file, doc] of pages) {
    if (doc.tree.element !== 'Tokens') continue
    if (findByAddress(doc, address)?.element === 'Variable') return file
  }
  return null
}

function findByAddress(doc: UidxDocument, address: string) {
  const walk = (node: (typeof doc)['tree']): (typeof doc)['tree'] | null => {
    if (node.address === address) return node
    for (const child of node.children) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(doc.tree)
}
