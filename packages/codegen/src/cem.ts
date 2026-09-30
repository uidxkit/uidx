import { enumValues } from '@uidx/format'

import type { ComponentModel } from './model.js'

/**
 * A Custom Elements Manifest (schema 2.1.0) written from the identities: what
 * tooling that reads CEM — IDE completions, Storybook for web components,
 * `@wc-toolkit` wrappers, linters — learns about the design system's elements.
 * CEM has no field for accessibility or behaviour, so those travel in a
 * namespaced `x-uidx` extension beside each declaration rather than being
 * dropped.
 */
export function emitCem(models: readonly ComponentModel[]): string {
  const modules = models
    .filter((model) => model.tag !== undefined)
    .map((model) => {
      const contract = model.contract
      const declaration: Record<string, unknown> = {
        kind: 'class',
        name: model.identifier,
        tagName: model.tag,
        customElement: true,
        ...(model.doc.intent.raw.trim()
          ? { description: model.doc.intent.raw.replace(/^#{1,6}\s.*$/gm, '').trim() }
          : {}),
        attributes: (contract?.props ?? [])
          .filter(
            (prop) =>
              enumValues(prop.type) || ['boolean', 'string', 'number'].includes(prop.type ?? ''),
          )
          .map((prop) => ({
            name: prop.name,
            type: {
              text: enumValues(prop.type)
                ? enumValues(prop.type)!
                    .map((v) => `'${v}'`)
                    .join(' | ')
                : prop.type,
            },
            description: prop.description,
            ...(prop.default === undefined ? {} : { default: JSON.stringify(prop.default) }),
          })),
        events: (contract?.events ?? []).map((event) => ({
          name: event.name,
          description: event.description,
          ...(event.detail ? { type: { text: `CustomEvent<${event.detail}>` } } : {}),
        })),
        slots: (contract?.slots ?? []).map((slot) => ({
          name: slot.name === 'default' ? '' : slot.name,
          description: slot.description,
        })),
        cssParts: model.parts.map((part) => ({
          name: part.libraryName,
          description: contract?.parts.find((entry) => entry.name === part.name)?.description ?? '',
        })),
        cssStates: (contract?.states ?? []).map((state) => ({
          name: state.name,
          description: state.description,
        })),
        'x-uidx': {
          status: model.node.attrs.status?.value ?? null,
          accessibility: contract?.accessibility ?? null,
          form: contract?.form ?? null,
          behavior: (model.spec?.behavior ?? []).map((rule) => ({ id: rule.id, text: rule.text })),
          composes: contract?.composes ?? [],
        },
      }
      return {
        kind: 'javascript-module',
        path: `${model.stem}.js`,
        declarations: [declaration],
        exports: [
          {
            kind: 'custom-element-definition',
            name: model.tag,
            declaration: { name: model.identifier },
          },
        ],
      }
    })
  return `${JSON.stringify({ schemaVersion: '2.1.0', readme: '', modules }, null, 2)}\n`
}
