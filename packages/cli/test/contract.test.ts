import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { run, type Io } from '../src/index.js'

/**
 * `uidx contract` states where a use's outer box lands (ADR 0018 §6). A
 * composition's box is the box of the component it holds, which is usually on
 * another page, so the pages given are read together.
 */
const examples = resolve(import.meta.dirname, '../../../examples/design-system/.uidx')

async function contract(...files: string[]) {
  const out: string[] = []
  const err: string[] = []
  const io: Io = { out: (t) => out.push(t), err: (t) => err.push(t), cwd: examples }
  const code = await run(['contract', ...files], io)
  return { code, json: JSON.parse(out.join('')), err: err.join('') }
}

type Page = { file: string; components: { name: string; box: unknown; laysOut: unknown }[] }

describe('uidx contract and the outer box', () => {
  it('follows a composition to the component it holds on another page', async () => {
    const { code, json, err } = await contract('field.uidx', 'checkbox-field.uidx')
    expect([code, err]).toEqual([0, ''])
    const composition = (json as Page[])
      .find((page) => page.file === 'checkbox-field.uidx')!
      .components.find((component) => component.name === 'CheckboxField')!
    expect(composition.box).toEqual({ target: 'instance', node: 'field', component: 'Field' })
    expect(composition.laysOut).toBe(true)
  })

  it('cannot say whether a composition lays out when its component is not given', async () => {
    const { json } = await contract('checkbox-field.uidx')
    expect((json as Page).components[0]!.laysOut).toBeNull()
  })

  it('prints the role table and the hooks', async () => {
    const { json } = await contract('field.uidx')
    expect(
      (json as { instanceBox: { hooks: Record<string, string> } }).instanceBox.hooks.fills,
    ).toBe('--uidx-fill')
  })
})
