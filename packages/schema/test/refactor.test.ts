import { describe, expect, it } from 'vitest'
import {
  applyPatches,
  inversePatches,
  parseOrThrow,
  type UidxDocument,
  type UidxPatch,
} from '@uidx/format'

import { buildTokenIndex } from '../src/token-index.js'
import { buildDependentsIndex } from '../src/symbol-deps.js'
import {
  deleteCollection,
  deleteToken,
  renameCollection,
  renameComponent,
  renameToken,
  setCollectionModes,
} from '../src/refactor.js'
import { defaultTuple, TokenResolver } from '../src/resolve-modes.js'

const doc = (id: string, body: string) =>
  parseOrThrow(`---\nid: ${id}\n---\n\n## Visual Contract\n\n${body}\n`)

const CORE = doc(
  'core',
  `<Tokens>
  <Collection name="palette">
    <Variable name="blue-500" type="COLOR" value={{ r: 0.1, g: 0.4, b: 0.9, a: 1 }} />
    <Variable name="lonely" type="FLOAT" value={1} />
  </Collection>
  <Collection name="semantic" modes={['light', 'dark']}>
    <Variable name="brand" type="COLOR">
      <Mode name="light" value="{palette#blue-500}" />
      <Mode name="dark" value={{ r: 1, g: 1, b: 1, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`,
)

const HOME = doc(
  'home',
  `<Page>
  <Frame name="hero" fills={[{ type: 'SOLID', color: '{palette#blue-500}' }]} />
  <Frame name="side" opacity="{palette#blue-500}" />
</Page>`,
)

const pages = new Map([
  ['core.uidx', CORE],
  ['home.uidx', HOME],
])
const deps = () => buildDependentsIndex(pages)

describe('renameToken', () => {
  it('renames the declaration after rewriting its same-file references', () => {
    const plan = renameToken(pages, deps(), 'palette#blue-500', 'azure-500')
    const core = plan.byFile.get('core.uidx')!
    expect(core.at(-1)).toEqual({
      op: 'set',
      address: 'palette#blue-500',
      prop: 'name',
      value: 'azure-500',
    })
    expect(core.slice(0, -1)).toContainEqual({
      op: 'set-mode',
      address: 'semantic#brand',
      mode: 'light',
      value: '{palette#azure-500}',
    })
  })

  it('rewrites cross-file scene references, aliases nested in structured values included', () => {
    const plan = renameToken(pages, deps(), 'palette#blue-500', 'azure-500')
    const home = plan.byFile.get('home.uidx')!
    expect(home).toContainEqual({
      op: 'set',
      address: 'hero',
      prop: 'fills',
      value: [{ type: 'SOLID', color: '{palette#azure-500}' }],
    })
    expect(home).toContainEqual({
      op: 'set',
      address: 'side',
      prop: 'opacity',
      value: '{palette#azure-500}',
    })
  })

  it('echoes the dependents for the blast-radius display', () => {
    const plan = renameToken(pages, deps(), 'palette#blue-500', 'azure-500')
    expect(plan.dependents).toHaveLength(3)
  })

  it('renames an unreferenced token with a single patch', () => {
    const plan = renameToken(pages, deps(), 'palette#lonely', 'solo')
    expect([...plan.byFile.keys()]).toEqual(['core.uidx'])
    expect(plan.byFile.get('core.uidx')).toEqual([
      { op: 'set', address: 'palette#lonely', prop: 'name', value: 'solo' },
    ])
    expect(plan.dependents).toEqual([])
  })
})

describe('deleteToken', () => {
  const index = () => buildTokenIndex([...pages.values()])

  it('inlines the resolved literal into dependents before removing the declaration', () => {
    const plan = deleteToken(pages, index(), deps(), 'palette#blue-500')
    const core = plan.byFile.get('core.uidx')!
    // The mode child that aliased it holds the literal it resolved to.
    expect(core).toContainEqual({
      op: 'set-mode',
      address: 'semantic#brand',
      mode: 'light',
      value: { r: 0.1, g: 0.4, b: 0.9, a: 1 },
    })
    // The removal is the batch's last word.
    expect(core.at(-1)).toEqual({ op: 'remove-node', address: 'palette#blue-500' })
    expect(plan.declaringFile).toBe('core.uidx')
  })

  it('inlines into scene attributes, nested values included', () => {
    const plan = deleteToken(pages, index(), deps(), 'palette#blue-500')
    const home = plan.byFile.get('home.uidx')!
    expect(home).toContainEqual({
      op: 'set',
      address: 'hero',
      prop: 'fills',
      value: [{ type: 'SOLID', color: { r: 0.1, g: 0.4, b: 0.9, a: 1 } }],
    })
  })

  it('flags dependents that flatten a moded token, and only those', () => {
    // Nothing references a moded token in the shared fixture; build one here.
    const moded = doc(
      'theme',
      `<Tokens>
  <Collection name="mood" modes={['light', 'dark']}>
    <Variable name="ground" type="COLOR">
      <Mode name="light" value={{ r: 1, g: 1, b: 1, a: 1 }} />
      <Mode name="dark" value={{ r: 0, g: 0, b: 0, a: 1 }} />
    </Variable>
  </Collection>
</Tokens>`,
    )
    const scene = doc(
      'stage',
      `<Page>
  <Frame name="canvas" fills={[{ type: 'SOLID', color: '{mood#ground}' }]} />
</Page>`,
    )
    const set = new Map([
      ['theme.uidx', moded],
      ['stage.uidx', scene],
    ])
    const plan = deleteToken(
      set,
      buildTokenIndex([...set.values()]),
      buildDependentsIndex(set),
      'mood#ground',
    )
    expect(plan.flattened).toHaveLength(1)
    expect(plan.flattened[0]!.address).toBe('canvas')
    // The scene attr got the default-mode (leftmost) literal.
    expect(plan.byFile.get('stage.uidx')).toContainEqual({
      op: 'set',
      address: 'canvas',
      prop: 'fills',
      value: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
    })
    // No flattening flagged for the single-valued fixture token.
    expect(deleteToken(pages, index(), deps(), 'palette#blue-500').flattened).toEqual([])
  })

  it('deletes an unreferenced token with one removal', () => {
    const plan = deleteToken(pages, index(), deps(), 'palette#lonely')
    expect([...plan.byFile.keys()]).toEqual(['core.uidx'])
    expect(plan.byFile.get('core.uidx')).toEqual([{ op: 'remove-node', address: 'palette#lonely' }])
  })
})

describe('deleteCollection', () => {
  const planFor = (set: Map<string, UidxDocument>, name: string) =>
    deleteCollection(set, buildTokenIndex([...set.values()]), buildDependentsIndex(set), name)

  it('removes exactly the named empty collection and can restore it with undo', () => {
    const original = doc(
      'empty',
      `<Tokens>
      <Collection name="palette" />
      <Collection name="palette-other"><Variable name="keep" type="FLOAT" value={2} /></Collection>
    </Tokens>`,
    )
    const plan = planFor(new Map([['empty.uidx', original]]), 'palette')
    expect(plan.tokens).toEqual([])
    expect(plan.dependents).toEqual([])
    const patches = plan.byFile.get('empty.uidx')!
    expect(patches).toEqual([{ op: 'remove-node', address: 'palette' }])
    const removed = applyPatches(original.source, patches)
    expect(parseOrThrow(removed.source).tree.children.map((node) => node.name)).toEqual([
      'palette-other',
    ])
    const restored = applyPatches(removed.source, inversePatches(original, patches))
    expect(parseOrThrow(restored.source).tree.children.map((node) => node.name)).toEqual([
      'palette',
      'palette-other',
    ])
  })

  it('preserves outside aliases, merges replacements in one attribute, and discards internal aliases', () => {
    const library = doc(
      'library',
      `<Tokens>
      <Collection name="palette">
        <Variable name="black" type="COLOR" value={{ r: 0, g: 0, b: 0, a: 1 }} />
        <Variable name="white" type="COLOR" value={{ r: 1, g: 1, b: 1, a: 1 }} />
        <Variable name="internal" type="COLOR" value="{palette#black}" />
      </Collection>
      <Collection name="semantic" modes={['light', 'dark']}>
        <Variable name="background" type="COLOR">
          <Mode name="light" value="{palette#white}" />
          <Mode name="dark" value="{palette#black}" />
        </Variable>
      </Collection>
    </Tokens>`,
    )
    const outside = doc(
      'outside',
      `<Tokens><Collection name="outside">
      <Variable name="text" type="COLOR" value="{palette#internal}" />
    </Collection></Tokens>`,
    )
    const scene = doc(
      'scene',
      `<Page><Frame name="box" fills={[
      { type: 'SOLID', color: '{palette#black}' },
      { type: 'SOLID', color: '{palette#white}' },
      { type: 'SOLID', color: '{palette#black}' }
    ]} /></Page>`,
    )
    const set = new Map([
      ['library.uidx', library],
      ['outside.uidx', outside],
      ['scene.uidx', scene],
    ])
    const plan = planFor(set, 'palette')
    expect(plan.tokens).toHaveLength(3)
    expect(plan.dependents).toHaveLength(4)
    expect(plan.byFile.get('library.uidx')).toHaveLength(3)
    expect(plan.byFile.get('library.uidx')!.at(-1)).toEqual({
      op: 'remove-node',
      address: 'palette',
    })
    expect(plan.byFile.get('scene.uidx')).toEqual([
      {
        op: 'set',
        address: 'box',
        prop: 'fills',
        value: [
          { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } },
          { type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } },
          { type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      },
    ])
    const updated = new Map(
      [...set].map(([file, original]) => [
        file,
        parseOrThrow(applyPatches(original.source, plan.byFile.get(file) ?? []).source),
      ]),
    )
    expect([...buildDependentsIndex(updated).ofToken.keys()]).toEqual([])
    const index = buildTokenIndex([...updated.values()])
    expect(index.collections.has('palette')).toBe(false)
    expect(new TokenResolver(index).resolve(defaultTuple(index)).get('outside#text')).toEqual({
      r: 0,
      g: 0,
      b: 0,
      a: 1,
    })
  })

  it('uses the scene mode before clearing only the removed collection’s mode selections', () => {
    const library = doc(
      'library',
      `<Tokens>
      <Collection name="theme" modes={['light', 'dark']}>
        <Variable name="opacity" type="FLOAT">
          <Mode name="light" value={1} /><Mode name="dark" value={0.5} />
        </Variable>
      </Collection>
      <Collection name="density" modes={['roomy', 'compact']} />
    </Tokens>`,
    )
    const scene = doc(
      'scene',
      `<Page>
      <Frame name="root" modes={{ theme: 'dark', density: 'compact' }}>
        <Frame name="child" opacity="{theme#opacity}" />
      </Frame>
      <Frame name="other" modes={{ theme: 'light' }} />
    </Page>`,
    )
    const set = new Map([
      ['library.uidx', library],
      ['scene.uidx', scene],
    ])
    const plan = planFor(set, 'theme')
    expect(plan.modeOverrides).toBe(2)
    expect(plan.flattened).toHaveLength(1)
    const updated = parseOrThrow(applyPatches(scene.source, plan.byFile.get('scene.uidx')!).source)
    expect(updated.tree.children[0]!.attrs.modes!.value).toEqual({ density: 'compact' })
    expect(updated.tree.children[0]!.children[0]!.attrs.opacity!.value).toBe(0.5)
    expect(updated.tree.children[1]!.attrs.modes).toBeUndefined()
  })

  it('allows unused broken internal aliases to be removed together', () => {
    const broken = doc(
      'broken',
      `<Tokens><Collection name="broken">
      <Variable name="a" type="FLOAT" value="{broken#b}" />
      <Variable name="b" type="FLOAT" value="{broken#a}" />
    </Collection></Tokens>`,
    )
    const plan = planFor(new Map([['broken.uidx', broken]]), 'broken')
    expect(plan.byFile.get('broken.uidx')).toEqual([{ op: 'remove-node', address: 'broken' }])
  })

  it('refuses removal when an outside reference cannot be preserved', () => {
    const broken = doc(
      'broken',
      `<Tokens>
      <Collection name="broken"><Variable name="a" type="FLOAT" value="{missing#b}" /></Collection>
      <Collection name="outside"><Variable name="c" type="FLOAT" value="{broken#a}" /></Collection>
    </Tokens>`,
    )
    expect(() => planFor(new Map([['broken.uidx', broken]]), 'broken')).toThrow(
      'fix the broken chain before deleting it',
    )
  })

  it('refuses a collection that no longer exists', () => {
    expect(() => planFor(pages, 'missing')).toThrow('no collection named "missing"')
  })
})

describe('renameComponent', () => {
  const LIB = doc(
    'lib',
    `<Page>
  <Component name="Card" status="draft">
    <Frame name="root" />
  </Component>
  <Component name="CardHeader" status="draft">
    <Frame name="root" />
  </Component>
  <Component name="Icon/Check" status="draft">
    <Frame name="root" />
  </Component>
</Page>`,
  )
  const USE = doc(
    'use',
    `<Page>
  <Instance name="a" component="Card" props={{ icon: 'Icon/Check' }} />
  <Instance name="b" component="CardHeader" />
</Page>`,
  )
  const set = new Map([
    ['lib.uidx', LIB],
    ['use.uidx', USE],
  ])
  const index = () => buildDependentsIndex(set)

  it('renames the definition and repoints every instance, exact matches only', () => {
    const plan = renameComponent(set, index(), 'Card', 'Panel')
    expect(plan.byFile.get('lib.uidx')!.at(-1)).toEqual({
      op: 'set',
      address: 'Card',
      prop: 'name',
      value: 'Panel',
    })
    expect(plan.byFile.get('use.uidx')).toContainEqual({
      op: 'set',
      address: 'a',
      prop: 'component',
      value: 'Panel',
    })
    // CardHeader is its own name, not a near miss to rewrite.
    expect(plan.byFile.get('use.uidx')!.some((p) => 'address' in p && p.address === 'b')).toBe(
      false,
    )
  })

  it('rewrites an instance-swap prop that names the component', () => {
    const plan = renameComponent(set, index(), 'Icon/Check', 'Icon/Tick')
    expect(plan.byFile.get('use.uidx')).toContainEqual({
      op: 'set',
      address: 'a',
      prop: 'props',
      value: { icon: 'Icon/Tick' },
    })
  })
})

describe('styles-table references (ADR 0016 §2)', () => {
  const tokens = doc(
    'tokens',
    `<Tokens>
  <Collection name="surface">
    <Variable name="accent" type="COLOR" value={{ r: 0, g: 0.5, b: 1, a: 1 }} />
    <Variable name="accentHover" type="COLOR" value={{ r: 0, g: 0.4, b: 0.9, a: 1 }} />
  </Collection>
</Tokens>`,
  )
  const button = parseOrThrow(`---
id: button
---

## Visual Contract

<Page>
  <Component name="Button" fills="{surface#accent}" width={80} height={32} />
</Page>

<Styles>
  <Style state="hover" root:fills="{surface#accentHover}" root:strokes="{surface#accentHover}" />
</Styles>

## Contract

<Props>
  <Prop name="disabled" type="boolean" default={false} visual>Inert.</Prop>
</Props>
`)
  const styled = new Map<string, UidxDocument>([
    ['tokens.uidx', tokens],
    ['button.uidx', button],
  ])

  it('counts a styles cell as a dependent', () => {
    const found = buildDependentsIndex(styled).ofToken.get('surface#accentHover') ?? []
    expect(found.map((d) => [d.kind, d.prop, d.style?.keys])).toEqual([
      ['style', 'root:fills', { state: 'hover' }],
      ['style', 'root:strokes', { state: 'hover' }],
    ])
  })

  it('rewrites styles cells when the token is renamed', () => {
    const plan = renameToken(
      styled,
      buildDependentsIndex(styled),
      'surface#accentHover',
      'accentPressed',
    )
    const patches = plan.byFile.get('button.uidx')!
    const next = applyPatches(button.source, patches).source
    expect(next).toContain('root:fills="{surface#accentPressed}"')
    expect(next).toContain('root:strokes="{surface#accentPressed}"')
    expect(next).not.toContain('accentHover')
  })

  it('inlines the literal into styles cells when the token is deleted', () => {
    const plan = deleteToken(
      styled,
      buildTokenIndex([...styled.values()]),
      buildDependentsIndex(styled),
      'surface#accentHover',
    )
    const next = applyPatches(button.source, plan.byFile.get('button.uidx')!).source
    expect(next).not.toContain('accentHover')
    expect(parseOrThrow(next).spec?.styles?.[0]?.values.root?.fills).not.toBeUndefined()
  })
})

describe('collection rename and modes', () => {
  const apply = (plan: { byFile: ReadonlyMap<string, readonly UidxPatch[]> }) =>
    new Map(
      [...pages].map(([file, page]) => [
        file,
        applyPatches(page.source, [...(plan.byFile.get(file) ?? [])]).source,
      ]),
    )

  it('renames a collection, repointing every reference and override', () => {
    const themed = doc(
      'themed',
      `<Page>
  <Frame name="card" modes={{ semantic: 'dark' }} fills={[{ type: 'SOLID', color: '{semantic#brand}' }]} />
</Page>`,
    )
    const all = new Map([...pages, ['themed.uidx', themed]])
    const plan = renameCollection(all, buildDependentsIndex(all), 'palette', 'base')
    const core = applyPatches(CORE.source, [...plan.byFile.get('core.uidx')!]).source
    expect(core).toContain('<Collection name="base">')
    expect(core).toContain('value="{base#blue-500}"')
    const home = applyPatches(HOME.source, [...plan.byFile.get('home.uidx')!]).source
    expect(home).toContain("color: '{base#blue-500}'")
    expect(home).toContain('opacity="{base#blue-500}"')

    const moded = renameCollection(all, buildDependentsIndex(all), 'semantic', 'theme')
    const page = applyPatches(themed.source, [...moded.byFile.get('themed.uidx')!]).source
    expect(page).toContain("modes={{ theme: 'dark' }}")
    expect(page).toContain('{theme#brand}')
    expect(parseOrThrow(page)).toBeTruthy()
  })

  it('adds a mode copied from another, renames one, and folds back to a plain value', () => {
    const added = apply(
      setCollectionModes(pages, 'palette', [
        { name: 'light', from: 'default' },
        { name: 'dark', from: 'default' },
      ]),
    )
    const core = parseOrThrow(added.get('core.uidx')!)
    const index = buildTokenIndex([core])
    expect(index.collections.get('palette')!.modes).toEqual(['light', 'dark'])
    expect(index.entries.get('palette#lonely')!.valuesByMode).toEqual({ light: 1, dark: 1 })
    // The semantic alias into the palette survives the rewrite.
    expect(index.entries.get('semantic#brand')!.valuesByMode.light).toBe('{palette#blue-500}')

    const renamed = apply(
      setCollectionModes(pages, 'semantic', [
        { name: 'day', from: 'light' },
        { name: 'night', from: 'dark' },
      ]),
    ).get('core.uidx')!
    const night = buildTokenIndex([parseOrThrow(renamed)])
    expect(night.collections.get('semantic')!.modes).toEqual(['day', 'night'])
    expect(night.entries.get('semantic#brand')!.valuesByMode).toEqual({
      day: '{palette#blue-500}',
      night: { r: 1, g: 1, b: 1, a: 1 },
    })

    const folded = apply(
      setCollectionModes(pages, 'semantic', [{ name: 'light', from: 'light' }]),
    ).get('core.uidx')!
    const plain = buildTokenIndex([parseOrThrow(folded)])
    expect(plain.collections.get('semantic')!.modes).toEqual(['default'])
    expect(plain.entries.get('semantic#brand')!.valuesByMode).toEqual({
      default: '{palette#blue-500}',
    })
    expect(() => setCollectionModes(pages, 'semantic', [])).toThrow(/at least one/)
  })

  it('re-keys node overrides when a mode is renamed and drops them when it goes', () => {
    const themed = doc(
      'themed',
      `<Page>
  <Frame name="card" modes={{ semantic: 'dark' }} />
</Page>`,
    )
    const all = new Map([...pages, ['themed.uidx', themed]])
    const renamed = setCollectionModes(all, 'semantic', [
      { name: 'light', from: 'light' },
      { name: 'night', from: 'dark' },
    ])
    expect(renamed.byFile.get('themed.uidx')).toEqual([
      { op: 'set', address: 'card', prop: 'modes', value: { semantic: 'night' } },
    ])
    const removed = setCollectionModes(all, 'semantic', [{ name: 'light', from: 'light' }])
    expect(removed.byFile.get('themed.uidx')).toEqual([
      { op: 'remove', address: 'card', prop: 'modes' },
    ])
  })
})
