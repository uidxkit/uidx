import { enumValues } from '@uidx/format'
import { modelOfType } from '@uidx/schema/design-system'

import type { ComponentModel } from './model.js'
import { tsType } from './react.js'

/**
 * An identity rendered onto a React component the team already ships
 * (`uidx.json` `codegen.react`), instead of onto a headless custom element:
 * the design system's contract stays the design system's, and a small
 * generated adapter translates it into the library's spelling — the way
 * Figma's Code Connect or Builder's mappers map a design component onto a
 * code one, but checked into the repo as ordinary source.
 *
 * ```json
 * "react": {
 *   "Button": {
 *     "from": "@acme/ui", "export": "Button",
 *     "props": { "variant": "appearance" },
 *     "values": { "variant": { "primary": "solid" } },
 *     "events": { "press": "onClick" },
 *     "children": "label"
 *   }
 * }
 * ```
 */
export interface ReactBinding {
  /** The module the component is imported from. */
  from: string
  /** Its export name; the component's own name when absent. */
  export?: string
  /** Contract prop → the library's prop name; unmapped props pass under their own name. */
  props?: Record<string, string>
  /** Contract prop → contract value → the library's value. */
  values?: Record<string, Record<string, string>>
  /** Contract event → the library's callback prop; `on<Event>` when absent. */
  events?: Record<string, string>
  /** The contract prop (or slot) passed as the library component's children. */
  children?: string
  /** Contract props the library has no equivalent for, left out of the call. */
  omit?: string[]
}

function pascal(text: string): string {
  return text
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('')
}

export function emitReactAdapter(model: ComponentModel, binding: ReactBinding): string {
  const contract = model.contract
  const exported = binding.export ?? model.identifier
  const models = new Set<string>()
  const lines: string[] = []
  const names: string[] = []
  const call: string[] = []
  const tables: string[] = []

  for (const prop of contract?.props ?? []) {
    const found = modelOfType(prop.type, model.spec, model.models)
    if (found) models.add(pascal(found.model.name))
    const optional = prop.default !== undefined || !found
    lines.push(
      `  /** ${prop.description} */`,
      `  ${prop.name}${optional ? '?' : ''}: ${tsType(model, prop.type)}`,
    )
    const fallback =
      prop.default !== undefined && prop.default !== null && typeof prop.default !== 'boolean'
        ? ` = ${JSON.stringify(prop.default)}`
        : ''
    names.push(`${prop.name}${fallback}`)
    if (binding.omit?.includes(prop.name) || binding.children === prop.name) continue
    const target = binding.props?.[prop.name] ?? prop.name
    const mapped = binding.values?.[prop.name]
    if (mapped) {
      const table = `${prop.name}Values`
      // Every value of an enum is listed, unmapped ones as themselves, so the
      // table's literal types say exactly what the library receives.
      const domain = enumValues(prop.type)
      const full = domain
        ? Object.fromEntries(domain.map((value) => [value, mapped[value] ?? value]))
        : mapped
      tables.push(
        domain
          ? `const ${table} = ${JSON.stringify(full)} as const`
          : `const ${table}: Record<string, string> = ${JSON.stringify(full)}`,
      )
      call.push(
        domain
          ? `${target}={${prop.name} === undefined ? undefined : ${table}[${prop.name}]}`
          : `${target}={${prop.name} === undefined ? undefined : (${table}[${prop.name}] ?? ${prop.name})}`,
      )
    } else call.push(`${target}={${prop.name}}`)
  }
  for (const slot of contract?.slots ?? []) {
    const name = slot.name === 'default' ? 'children' : slot.name
    lines.push(`  /** ${slot.description} */`, `  ${name}?: ReactNode`)
    names.push(name)
    if (binding.children === slot.name || slot.name === 'default') continue
    call.push(`${binding.props?.[slot.name] ?? slot.name}={${slot.name}}`)
  }
  for (const event of contract?.events ?? []) {
    const handler = `on${pascal(event.name)}`
    lines.push(
      `  /** ${event.description} */`,
      `  ${handler}?: (detail: ${event.detail ?? 'unknown'}) => void`,
    )
    names.push(handler)
    call.push(`${binding.events?.[event.name] ?? handler}={${handler}}`)
  }
  const childExpression =
    binding.children !== undefined
      ? binding.children === 'default'
        ? 'children'
        : binding.children
      : (contract?.slots ?? []).some((slot) => slot.name === 'default')
        ? 'children'
        : null

  const needsNode = (contract?.slots ?? []).length > 0
  const imports = [
    ...(needsNode ? [`import type { ReactNode } from 'react'`] : []),
    `import { ${exported} as Library } from '${binding.from}'`,
  ]
  if (models.size) imports.push(`import type { ${[...models].sort().join(', ')} } from './models'`)
  const open = `    <Library${call.length ? ` ${call.join(' ')}` : ''}`
  return `${[
    `// ${model.name} — generated by uidx codegen from its .uidx file, mapped onto ${binding.from}. Do not edit; change the file or uidx.json's codegen.react.`,
    '',
    ...imports,
    '',
    ...(tables.length ? [...tables, ''] : []),
    `export interface ${model.identifier}Props {`,
    ...lines,
    '}',
    '',
    `export function ${model.identifier}({ ${names.join(', ')} }: ${model.identifier}Props) {`,
    `  return (`,
    childExpression ? `${open}>{${childExpression}}</Library>` : `${open} />`,
    `  )`,
    `}`,
  ].join('\n')}\n`
}
