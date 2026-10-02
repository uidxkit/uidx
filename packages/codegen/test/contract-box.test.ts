import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOrThrow } from '@uidx/format'
import { generate } from '../src/index.js'

/**
 * The contract target states where a use's outer box lands (ADR 0018 §6). A
 * composition's box is the box of the component it holds, which is on another
 * page, so the generator looks it up across every page it was given.
 */
const examples = resolve(import.meta.dirname, '../../../examples/design-system/.uidx')
const page = (file: string) => ({
  file,
  doc: parseOrThrow(readFileSync(resolve(examples, file), 'utf8'), file),
})

describe('the generated contract and the outer box', () => {
  it('says a composition lays out when the component it holds does', () => {
    const { files } = generate({
      pages: [page('field.uidx'), page('checkbox-field.uidx')],
      targets: ['contract'],
    })
    const json = JSON.parse(files.get('contract/checkbox-field.json')!)
    expect(json.components[0]).toMatchObject({
      name: 'CheckboxField',
      box: { target: 'instance', node: 'field', component: 'Field' },
      laysOut: true,
    })
    expect(json.instanceBox.hooks.textFills).toBe('--uidx-text-color')
  })
})
