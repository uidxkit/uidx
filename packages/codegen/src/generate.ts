import type { Diagnostic, UidxDocument } from '@uidx/format'
import { contractJson } from '@uidx/schema/design-system'
import { tokensCss } from './css.js'
import { checkConformance } from './conformance.js'
import { emitCss, emitHtml } from './html.js'
import { componentModel, type ComponentModel, type Manifest } from './model.js'
import { emitElementTypes, emitIndex, emitModels, emitReact, emitRuntime } from './react.js'

export type Target = 'html' | 'react' | 'contract'

export interface GenerateInput {
  /** Component pages: every `<Component>` with an `implements` or a contract is rendered. */
  pages: readonly { file: string; doc: UidxDocument }[]
  /** Token pages, for `tokens.css`. */
  tokens?: readonly UidxDocument[]
  /** The headless library's `custom-elements.json`, for part tags and conformance. */
  manifest?: Manifest
  targets?: readonly Target[]
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

  const models: ComponentModel[] = []
  const owner = new Map<ComponentModel, string>()
  for (const { file, doc } of input.pages) {
    if (doc.tree.element === 'Tokens') continue
    for (const node of doc.tree.children) {
      if (node.element !== 'Component') continue
      const model = componentModel(node, doc, input.manifest)
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
      files.set(`html/${model.stem}.css`, emitCss(model))
      files.set(`html/${model.stem}.html`, emitHtml(model, { components: byName }))
    }
  }

  if (targets.has('react')) {
    if (tokens) files.set('react/tokens.css', tokens)
    const tags = new Set<string>()
    const modelSpecs = new Map<
      string,
      { spec: ComponentModel['spec']; model: ComponentModel['spec'] }
    >()
    for (const model of rendered) {
      files.set(`react/${model.identifier}.tsx`, emitReact(model, { components: byName }))
      files.set(`react/${model.stem}.css`, emitCss(model))
      if (model.tag) tags.add(model.tag)
      for (const part of model.parts) tags.add(part.tag)
      for (const spec of model.spec?.models ?? [])
        modelSpecs.set(spec.name, { spec: model.spec, model: model.spec })
    }
    const allModels = [
      ...new Map(
        rendered.flatMap((model) =>
          (model.spec?.models ?? []).map((m) => [m.name, { m, spec: model.spec }]),
        ),
      ).values(),
    ]
    files.set(
      'react/models.ts',
      emitModels(
        allModels.map((entry) => entry.m),
        mergeSpecs(allModels.map((entry) => entry.spec)),
      ),
    )
    files.set('react/runtime.ts', emitRuntime())
    files.set('react/elements.d.ts', emitElementTypes([...tags]))
    files.set('react/index.ts', emitIndex(rendered))
  }

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

/** One spec whose models are the union of several files' models, for `models.ts`. */
function mergeSpecs(
  specs: readonly (ComponentModel['spec'] | undefined)[],
): ComponentModel['spec'] {
  const models = new Map<string, NonNullable<ComponentModel['spec']>['models']>()
  const merged: NonNullable<NonNullable<ComponentModel['spec']>['models']> = []
  for (const spec of specs) {
    for (const model of spec?.models ?? []) {
      if (!models.has(model.name)) {
        models.set(model.name, [model])
        merged.push(model)
      }
    }
  }
  return { models: merged }
}
