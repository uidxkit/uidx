import { enumValues, type UidxNode } from '@uidx/format'
import { INSTANCE_BOX_HOOKS } from '@uidx/schema/design-system'
import { INSTANCE_BOX_SHORTHANDS } from '@uidx/schema/instance-box'

import { emitCss, instanceInlineStyle, type HtmlContext } from './html.js'
import type { ComponentModel } from './model.js'

/**
 * A Custom Elements Manifest (schema 2.1.0) written from the identities: what
 * tooling that reads CEM — IDE completions, Storybook for web components,
 * `@wc-toolkit` wrappers, linters — learns about the design system's elements.
 * CEM has no field for accessibility or behaviour, so those travel in a
 * namespaced `x-uidx` extension beside each declaration rather than being
 * dropped. Its `cssProperties` are the `--uidx-*` hooks each element reads:
 * the outer box and text colour a page may set on it (ADR 0018 §6).
 *
 * `ctx` holds every component, for the ones an element holds; the given
 * models alone when absent.
 */
export function emitCem(models: readonly ComponentModel[], ctx?: HtmlContext): string {
  const hooks = hookReader(
    ctx ?? { components: new Map(models.map((model) => [model.name, model])) },
  )
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
        cssProperties: hooks(model).map((prop) => ({
          name: INSTANCE_BOX_HOOKS[prop]!,
          description: hookDescription(prop),
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

/**
 * The hooks an element reads, as the instance attributes that set them, in
 * the hooks' order (ADR 0018 §6). Read off its own stylesheet, so the list is
 * exactly what a custom property set on the element changes: a shadow host
 * reads only what its design sets, padding is read only where the box lays
 * out, and no box hook where an instance it holds is the box.
 *
 * Text colour is never reset, so it also reaches the texts of the components
 * an element holds — unless the use of one sets its own, which is nearer.
 */
function hookReader(ctx: HtmlContext): (model: ComponentModel) => string[] {
  const sheets = new Map<ComponentModel, string>()
  const reads = (model: ComponentModel, hook: string): boolean => {
    let css = sheets.get(model)
    if (css === undefined) sheets.set(model, (css = emitCss(model, ctx)))
    return css.includes(`var(${hook},`) || css.includes(`var(${hook})`)
  }
  const text = INSTANCE_BOX_HOOKS.textFills!
  const textReaches = (model: ComponentModel, seen: Set<ComponentModel>): boolean => {
    if (reads(model, text)) return true
    if (seen.has(model)) return false
    seen.add(model)
    const holds = (node: UidxNode): boolean =>
      node.children.some((child) => {
        const name = child.element === 'Instance' ? child.attrs.component?.value : undefined
        const target = typeof name === 'string' ? ctx.components.get(name) : undefined
        if (
          target &&
          !(text in instanceInlineStyle(child, target, undefined)) &&
          textReaches(target, seen)
        )
          return true
        // A slot fill the use is given is this element's content too.
        return holds(child)
      })
    return holds(model.node)
  }
  return (model) =>
    Object.entries(INSTANCE_BOX_HOOKS)
      .filter(([prop, hook]) =>
        prop === 'textFills' ? textReaches(model, new Set()) : reads(model, hook),
      )
      .map(([prop]) => prop)
}

/** What each box hook styles, in CSS's words (ADR 0018 §6's table). */
const STYLES: Readonly<Record<string, string>> = {
  fills: 'background-color',
  strokes: 'border-color',
  strokeWeight: 'border-width',
  dashPattern: 'border-style (solid, dashed or none)',
  strokeTopWeight: 'border-top-width',
  strokeRightWeight: 'border-right-width',
  strokeBottomWeight: 'border-bottom-width',
  strokeLeftWeight: 'border-left-width',
  cornerRadius: 'border-radius',
  topLeftRadius: 'border-top-left-radius',
  topRightRadius: 'border-top-right-radius',
  bottomRightRadius: 'border-bottom-right-radius',
  bottomLeftRadius: 'border-bottom-left-radius',
  opacity: 'opacity',
  effects: 'box-shadow',
  paddingTop: 'padding-top',
  paddingRight: 'padding-right',
  paddingBottom: 'padding-bottom',
  paddingLeft: 'padding-left',
}

/** A hook's CEM description: what it styles, and the instance attribute it stands for. */
function hookDescription(prop: string): string {
  if (prop === 'textFills')
    return "The color of every text inside, which the components it holds inherit: an instance's textFills (ADR 0018 §4)."
  const shorthand = Object.entries(INSTANCE_BOX_SHORTHANDS).find(([, longhands]) =>
    longhands.includes(prop),
  )?.[0]
  const unset = shorthand ? `, or ${INSTANCE_BOX_HOOKS[shorthand]} where that is unset` : ''
  return `The outer box's ${STYLES[prop] ?? prop}: an instance's ${prop}${unset} (ADR 0018).`
}
