import { describe, expect, it } from 'vitest'
import { parseOrThrow, resolve } from '@uidx/format'

import { resolveSubject } from '../src/inspector-subject'

const page = (id: string, body: string) =>
  `---\nid: ${id}\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`

/**
 * One answer to "what are Contract, Connect and Code about": an instance is
 * about the component it uses, any other layer inside a component about that
 * component, so the tabs cannot disagree.
 */
describe('resolveSubject', () => {
  const doc = parseOrThrow(
    page(
      'list',
      `  <Component name="PersonRow" status="draft">
    <Text name="label" characters="Ada" />
  </Component>
  <Component name="List" status="draft" layoutMode="VERTICAL">
    <Frame name="body">
      <Instance name="row" component="PersonRow" />
      <Instance name="badge" component="Badge" />
    </Frame>
  </Component>
  <Instance name="list-1" component="List" />
  <Frame name="loose" width={10} height={10} />`,
    ),
  )
  const at = (address: string) => resolve(doc.tree, address)!

  it('is nothing, or several layers, before it is a node', () => {
    expect(resolveSubject(doc, null, 0)).toMatchObject({ kind: 'none', name: null, local: null })
    expect(resolveSubject(doc, at('List'), 2)).toMatchObject({ kind: 'multi', name: null })
  })

  it('is a component itself, with no relation', () => {
    const list = at('List')
    expect(resolveSubject(doc, list, 1)).toEqual({
      kind: 'component',
      name: 'List',
      local: list,
      definition: list,
      relation: null,
    })
  })

  it('resolves an instance to its definition, inside a component or on the page', () => {
    const row = resolveSubject(doc, at('List#body/row'), 1)
    expect(row).toMatchObject({ kind: 'instance', name: 'PersonRow', relation: 'of PersonRow' })
    expect(row.local).toBe(at('PersonRow'))
    const top = resolveSubject(doc, at('list-1'), 1)
    expect(top).toMatchObject({ kind: 'instance', name: 'List', relation: 'of List' })
    expect(top.local).toBe(at('List'))
  })

  it('finds a definition declared on another page, without making it local', () => {
    const badge = parseOrThrow(page('badge', `  <Component name="Badge" status="draft" />`)).tree
      .children[0]!
    const subject = resolveSubject(doc, at('List#body/badge'), 1, new Map([['Badge', badge]]))
    expect(subject).toMatchObject({ kind: 'instance', name: 'Badge', local: null })
    expect(subject.definition).toBe(badge)
  })

  it('resolves an inner layer to its enclosing component', () => {
    const subject = resolveSubject(doc, at('List#body'), 1)
    expect(subject).toMatchObject({ kind: 'inside', name: 'List', relation: 'of List' })
    expect(subject.local).toBe(at('List'))
    expect(resolveSubject(doc, at('PersonRow#label'), 1).name).toBe('PersonRow')
  })

  it('is outside for a layer in no component', () => {
    expect(resolveSubject(doc, at('loose'), 1)).toMatchObject({
      kind: 'outside',
      name: null,
      local: null,
      relation: null,
    })
  })
})
