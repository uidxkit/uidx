import type { Diagnostic, UidxDocument } from '@uidx/format'
import { contractJson } from '@uidx/schema/design-system'
import { tokensCss } from './css.js'
import { checkConformance } from './conformance.js'
import { emitCss, emitHtml } from './html.js'
import {
  componentModel,
  type ComponentModel,
  type LibraryBindings,
  type Manifest,
} from './model.js'
import { modelIndex } from '@uidx/schema/design-system'
import { emitElementTypes, emitIndex, emitModels, emitReact, emitRuntime } from './react.js'
import { emitStories } from './stories.js'
import { emitCem } from './cem.js'
import { emitReactAdapter, type ReactBinding } from './react-adapter.js'

export type Target = 'html' | 'react' | 'contract' | 'stories' | 'cem'

export interface GenerateInput {
  /** Component pages: every `<Component>` with an `implements` or a contract is rendered. */
  pages: readonly { file: string; doc: UidxDocument }[]
  /** Token pages, for `tokens.css`. */
  tokens?: readonly UidxDocument[]
  /** The headless library's `custom-elements.json`, for part tags and conformance. */
  manifest?: Manifest
  /** How the library spells things and its names for this document's (`uidx.json` `headless`). */
  library?: LibraryBindings
  targets?: readonly Target[]
  /** `uidx.json`'s `codegen.react`: components rendered onto an existing React library. */
  react?: Record<string, ReactBinding>
}

export interface GenerateOutput {
  /** Output path → contents. Paths are relative and use `/`. */
  files: Map<string, string>
  diagnostics: (Diagnostic & { file: string })[]
}

/**
 * Everything the code targets produce for a document set (ADR 0017 §3).
 *
 * A pure function of its input: the same pages and manifest give the same
 * bytes, which is what lets the example package commit its output as golden
 * files and fail CI when the output moves without the input moving.
 */
export function generate(input: GenerateInput): GenerateOutput {
  const targets = new Set(input.targets ?? ['html', 'react', 'contract'])
  const files = new Map<string, string>()
  const diagnostics: GenerateOutput['diagnostics'] = []

  // Models are shared across pages (ADR 0015 §1): one index for every component.
  const index = modelIndex(input.pages.map((page) => page.doc))
  const models: ComponentModel[] = []
  const owner = new Map<ComponentModel, string>()
  for (const { file, doc } of input.pages) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element !== 'Component') continue
      const model = componentModel(node, doc, input.manifest, index, input.library)
      models.push(model)
      owner.set(model, file)
    }
  }
  const byName = new Map(models.map((model) => [model.name, model]))
  const rendered = models.filter((model) => model.tag !== undefined || model.contract !== undefined)

  if (input.manifest) {
    for (const model of rendered) {
      for (const found of checkConformance(model, input.manifest)) {
        diagnostics.push({ ...found, file: owner.get(model)! })
      }
    }
  }

  const tokens = input.tokens?.length ? tokensCss(input.tokens) : ''

  if (targets.has('html')) {
    if (tokens) files.set('html/tokens.css', tokens)
    for (const model of rendered) {
      files.set(`html/${model.stem}.css`, emitCss(model, { components: byName }))
      files.set(`html/${model.stem}.html`, emitHtml(model, { components: byName }))
    }
  }

  if (targets.has('react')) {
    if (tokens) files.set('react/tokens.css', tokens)
    const tags = new Set<string>()
    for (const model of rendered) {
      const mapped = input.react?.[model.name]
      if (mapped) {
        // The library styles itself: the adapter carries no stylesheet.
        files.set(`react/${model.identifier}.tsx`, emitReactAdapter(model, mapped))
        continue
      }
      files.set(`react/${model.identifier}.tsx`, emitReact(model, { components: byName }))
      files.set(`react/${model.stem}.css`, emitCss(model, { components: byName }))
      if (model.tag) tags.add(model.tag)
      for (const part of model.parts) if (part.kind === 'element') tags.add(part.tag)
    }
    files.set('react/models.ts', emitModels(index))
    files.set('react/runtime.ts', emitRuntime())
    files.set('react/elements.d.ts', emitElementTypes([...tags]))
    files.set('react/index.ts', emitIndex(rendered))
    // Stories import the React wrappers, so they ride with the React target.
    if (targets.has('stories'))
      for (const model of rendered)
        files.set(`react/${model.identifier}.stories.tsx`, emitStories(model, Boolean(tokens)))
  }

  if (targets.has('cem')) files.set('custom-elements.json', emitCem(rendered))

  if (targets.has('contract')) {
    const seen = new Set<UidxDocument>()
    for (const model of rendered) {
      if (seen.has(model.doc)) continue
      seen.add(model.doc)
      files.set(
        `contract/${model.stem}.json`,
        `${JSON.stringify(contractJson(model.doc), null, 2)}\n`,
      )
    }
  }

  return { files, diagnostics }
}
