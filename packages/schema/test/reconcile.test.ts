import { describe, expect, it } from 'vitest'
import { applyPatchesIncremental, parseOrThrow, predictDocument } from '@uidx/format'
import { applyChanges, diffDocuments, fromSceneChange, toSceneGraph } from '../src/index.js'
import { buildTokenIndex } from '../src/token-index.js'
import { TokenResolver } from '../src/resolve-modes.js'

const doc = (body: string, id = 'demo') =>
  parseOrThrow(`---
id: ${id}
---

## Visual Contract

${body}
`)

const BASE = `<Component name="demo" status="draft">
  <Frame name="root" layoutMode="VERTICAL" cornerRadius={4}>
    <Text name="a" characters="A" />
    <Text name="b" characters="B" />
  </Frame>
</Component>`

describe('diffDocuments', () => {
  it('sees nothing when the document is unchanged', () => {
    expect(diffDocuments(doc(BASE), doc(BASE))).toEqual([])
  })

  it('reports only the property that changed', () => {
    const next = BASE.replace('cornerRadius={4}', 'cornerRadius={16}')
    expect(diffDocuments(doc(BASE), doc(next))).toEqual([
      { kind: 'update', address: 'demo#root', props: { cornerRadius: 16 } },
    ])
  })

  it('does not touch siblings when one node changes', () => {
    const next = BASE.replace('characters="A"', 'characters="AA"')
    const changes = diffDocuments(doc(BASE), doc(next))!
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'update', address: 'demo#root/a' })
  })

  it('maps renamed props through the prop table', () => {
    const next = BASE.replace('characters="A"', 'characters="changed"')
    expect(diffDocuments(doc(BASE), doc(next))).toEqual([
      // `characters` is stored as `text` on the scene node.
      { kind: 'update', address: 'demo#root/a', props: { text: 'changed' } },
    ])
  })

  it('restores the engine default when an attribute is deleted', () => {
    const next = BASE.replace(' cornerRadius={4}', '')
    const changes = diffDocuments(doc(BASE), doc(next))!
    expect(changes).toEqual([{ kind: 'update', address: 'demo#root', props: { cornerRadius: 0 } }])
  })

  it('reports an inserted node once, with its parent and index', () => {
    const next = BASE.replace(
      '    <Text name="b" characters="B" />',
      '    <Text name="mid" characters="M" />\n    <Text name="b" characters="B" />',
    )
    const changes = diffDocuments(doc(BASE), doc(next))!
    const inserts = changes.filter((c) => c.kind === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0]).toMatchObject({ kind: 'insert', parent: 'demo#root', index: 1 })
  })

  it('reports a removed node', () => {
    const next = BASE.replace('    <Text name="a" characters="A" />\n', '')
    const changes = diffDocuments(doc(BASE), doc(next))!
    expect(changes.filter((c) => c.kind === 'remove')).toEqual([
      { kind: 'remove', address: 'demo#root/a' },
    ])
  })

  it('removes an ancestor once rather than every descendant', () => {
    const nested = `<Component name="demo" status="draft">
  <Frame name="root">
    <Frame name="box">
      <Text name="deep" characters="D" />
    </Frame>
  </Frame>
</Component>`
    const next = `<Component name="demo" status="draft">
  <Frame name="root" />
</Component>`
    const removes = diffDocuments(doc(nested), doc(next))!.filter((c) => c.kind === 'remove')
    expect(removes).toEqual([{ kind: 'remove', address: 'demo#root/box' }])
  })

  it('reports a reorder as a move', () => {
    const next = `<Component name="demo" status="draft">
  <Frame name="root" layoutMode="VERTICAL" cornerRadius={4}>
    <Text name="b" characters="B" />
    <Text name="a" characters="A" />
  </Frame>
</Component>`
    const moves = diffDocuments(doc(BASE), doc(next))!.filter((c) => c.kind === 'move')
    expect(moves).toEqual([
      { kind: 'move', address: 'demo#root/b', parent: 'demo#root', index: 0 },
      { kind: 'move', address: 'demo#root/a', parent: 'demo#root', index: 1 },
    ])
  })

  it('demands a full rebuild when the component id changes', () => {
    // The frontmatter id is the root's scene id, so renaming it invalidates
    // every mapping at once.
    expect(diffDocuments(doc(BASE, 'one'), doc(BASE, 'two'))).toBeNull()
  })
})

describe('applyChanges', () => {
  const build = (body: string) => {
    const d = doc(body)
    return { doc: d, ...toSceneGraph(d) }
  }

  it('produces the same graph a full rebuild would', () => {
    const next = doc(BASE.replace('cornerRadius={4}', 'cornerRadius={16}'))
    const incremental = build(BASE)
    applyChanges(incremental, diffDocuments(incremental.doc, next)!)

    const rebuilt = toSceneGraph(next)
    for (const address of ['demo#root', 'demo#root/a', 'demo#root/b']) {
      const a = incremental.graph.getNode(address)!
      const b = rebuilt.graph.getNode(address)!
      expect({ w: a.width, h: a.height, r: a.cornerRadius, t: a.text }).toEqual({
        w: b.width,
        h: b.height,
        r: b.cornerRadius,
        t: b.text,
      })
    }
  })

  it('keeps node identity across an update, so selection survives', () => {
    const scene = build(BASE)
    const before = scene.graph.getNode('demo#root/a')
    const next = doc(BASE.replace('characters="A"', 'characters="AA"'))
    applyChanges(scene, diffDocuments(scene.doc, next)!)
    // Same object identity: nothing was destroyed and recreated.
    expect(scene.graph.getNode('demo#root/a')).toBe(before)
    expect(scene.graph.getNode('demo#root/a')!.text).toBe('AA')
  })

  it('inserts a node at the right index', () => {
    const scene = build(BASE)
    const next = doc(
      BASE.replace(
        '    <Text name="b" characters="B" />',
        '    <Text name="mid" characters="M" />\n    <Text name="b" characters="B" />',
      ),
    )
    applyChanges(scene, diffDocuments(scene.doc, next)!)
    expect(scene.graph.getChildren('demo#root').map((n) => n.id)).toEqual([
      'demo#root/a',
      'demo#root/mid',
      'demo#root/b',
    ])
  })

  it('removes a node', () => {
    const scene = build(BASE)
    const next = doc(BASE.replace('    <Text name="a" characters="A" />\n', ''))
    applyChanges(scene, diffDocuments(scene.doc, next)!)
    expect(scene.graph.getNode('demo#root/a')).toBeUndefined()
    expect(scene.graph.getChildren('demo#root').map((n) => n.id)).toEqual(['demo#root/b'])
  })

  it('reorders children', () => {
    const scene = build(BASE)
    const next = doc(`<Component name="demo" status="draft">
  <Frame name="root" layoutMode="VERTICAL" cornerRadius={4}>
    <Text name="b" characters="B" />
    <Text name="a" characters="A" />
  </Frame>
</Component>`)
    applyChanges(scene, diffDocuments(scene.doc, next)!)
    expect(scene.graph.getChildren('demo#root').map((n) => n.id)).toEqual([
      'demo#root/b',
      'demo#root/a',
    ])
  })

  it('re-runs layout so hug sizing follows the change', () => {
    const body = `<Component name="demo" status="draft">
  <Frame name="root" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO"
    counterAxisSizingMode="AUTO" paddingLeft={10} paddingRight={10}>
    <Rectangle name="box" width={20} height={20} />
  </Frame>
</Component>`
    const scene = build(body)
    expect(scene.graph.getNode('demo#root')!.width).toBe(40)

    const next = doc(body.replace('width={20}', 'width={60}'))
    applyChanges(scene, diffDocuments(scene.doc, next)!)
    expect(scene.graph.getNode('demo#root')!.width).toBe(80)
  })

  /**
   * The bimap has to move with the graph, or a rename silently costs the author
   * every later edit to that subtree.
   *
   * A rename changes the address of the node and everything under it, so it
   * arrives here as a remove plus an insert. Left alone, the map would still
   * hold the old ids and know nothing of the new ones — and `fromSceneChange`
   * reads an unknown scene id as "the SDK generated this, do not write" and
   * returns no patches at all. No banner, no rejection: the canvas moves and
   * the file does not.
   */
  /**
   * `fromScene` reads the scene's fills, which carry the defaults
   * `normalizeFills` added on the way in — `opacity: 1, visible: true` — while
   * the author may have written only `{ type, color }`. Comparing those raw
   * shapes calls the difference an edit and rewrites untouched nodes with
   * normalization noise; C8's field check caught a Vector's fills gaining
   * defaults because a *sibling* was given its first fill. Equal once both
   * sides are normalized means equal.
   */
  it('does not call normalization defaults an edit (C8)', () => {
    const body = `<Component name="demo" status="draft">
  <Frame name="root">
    <Vector name="icon" fills={[{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }]} />
  </Frame>
</Component>`
    const scene = build(body)
    const announced = scene.graph.getNode('demo#root/icon')!.fills
    expect(
      fromSceneChange(
        'demo#root/icon',
        { fills: announced },
        { doc: scene.doc, graph: scene.graph, addresses: scene.addresses },
      ),
    ).toEqual([])
  })

  describe('the address map', () => {
    it('follows a renamed subtree, so the next edit to it still writes', () => {
      const scene = build(BASE)
      const next = doc(BASE.replace('name="root"', 'name="trunk"'))
      applyChanges(scene, diffDocuments(scene.doc, next)!)

      expect(scene.addresses.addressOf('demo#root')).toBeUndefined()
      expect(scene.addresses.addressOf('demo#trunk')).toBe('demo#trunk')
      // The descendants moved with it, both ways.
      expect(scene.addresses.addressOf('demo#root/a')).toBeUndefined()
      expect(scene.addresses.sceneIdOf('demo#trunk/a')).toBe('demo#trunk/a')

      scene.graph.updateNode('demo#trunk', { cornerRadius: 12 })
      expect(
        fromSceneChange(
          'demo#trunk',
          { cornerRadius: 12 },
          { doc: next, graph: scene.graph, addresses: scene.addresses },
        ),
      ).toEqual([{ op: 'set', address: 'demo#trunk', prop: 'cornerRadius', value: 12 }])
    })

    it('follows a reparented node, so the next edit to it still writes', () => {
      const body = `<Component name="demo" status="draft">
  <Frame name="root">
    <Frame name="slot" />
    <Text name="a" characters="A" x={1} />
  </Frame>
</Component>`
      const scene = build(body)
      const next = doc(`<Component name="demo" status="draft">
  <Frame name="root">
    <Frame name="slot">
      <Text name="a" characters="A" x={1} />
    </Frame>
  </Frame>
</Component>`)
      applyChanges(scene, diffDocuments(scene.doc, next)!)

      expect(scene.addresses.addressOf('demo#root/a')).toBeUndefined()
      expect(scene.addresses.addressOf('demo#root/slot/a')).toBe('demo#root/slot/a')

      scene.graph.updateNode('demo#root/slot/a', { x: 9 })
      expect(
        fromSceneChange(
          'demo#root/slot/a',
          { x: 9 },
          { doc: next, graph: scene.graph, addresses: scene.addresses },
        ),
      ).toEqual([{ op: 'set', address: 'demo#root/slot/a', prop: 'x', value: 9 }])
    })

    it('forgets a deleted subtree rather than leaving it addressable', () => {
      const scene = build(BASE)
      const next = doc(
        BASE.replace(
          `  <Frame name="root" layoutMode="VERTICAL" cornerRadius={4}>
    <Text name="a" characters="A" />
    <Text name="b" characters="B" />
  </Frame>`,
          '  <Frame name="root" layoutMode="VERTICAL" cornerRadius={4} />',
        ),
      )
      applyChanges(scene, diffDocuments(scene.doc, next)!)

      expect(scene.addresses.addressOf('demo#root/a')).toBeUndefined()
      expect(scene.addresses.addressOf('demo#root/b')).toBeUndefined()
      // The surviving parent and the page are untouched.
      expect(scene.addresses.addressOf('demo#root')).toBe('demo#root')
      expect(scene.addresses.addressOf(scene.rootId)).toBe('')
    })
  })
})

describe('diffDocuments under modes (spec §3)', () => {
  const TOKENS = parseOrThrow(`---
id: t
---

## Visual Contract

<Tokens>
  <Collection name="density" modes={['comfy', 'compact']}>
    <Variable name="pad" type="FLOAT">
      <Mode name="comfy" value={16} />
      <Mode name="compact" value={4} />
    </Variable>
  </Collection>
</Tokens>
`)
  const tokensFor = () => {
    const index = buildTokenIndex([TOKENS])
    return { index, resolver: new TokenResolver(index) }
  }
  const page = (body: string) =>
    parseOrThrow(`---\nid: p\n---\n\n## Visual Contract\n\n<Page>\n${body}\n</Page>\n`)

  it('resolves an alias inside a compact subtree to the compact value', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="inner" cornerRadius={1} />
  </Frame>`)
    const after = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="inner" cornerRadius="{density#pad}" />
  </Frame>`)
    expect(diffDocuments(before, after, undefined, tokensFor())).toEqual([
      { kind: 'update', address: 'outer#inner', props: { cornerRadius: 4 } },
    ])
  })

  it('rebuilds when a modes attribute itself changes', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }} />`)
    const after = page(`  <Frame name="outer" modes={{ density: 'comfy' }} />`)
    expect(diffDocuments(before, after, undefined, tokensFor())).toBeNull()
  })

  it('an insert under a compact subtree carries the tuple and applies compact', () => {
    const before = page(`  <Frame name="outer" modes={{ density: 'compact' }} />`)
    const after = page(`  <Frame name="outer" modes={{ density: 'compact' }}>
    <Frame name="added" cornerRadius="{density#pad}" />
  </Frame>`)
    const tokens = tokensFor()
    const scene = toSceneGraph(before, { tokens })
    const changes = diffDocuments(before, after, undefined, tokens)!
    expect(changes[0]).toMatchObject({ kind: 'insert', parent: 'outer' })
    applyChanges(scene, changes, { tokens })
    expect(scene.graph.getNode('outer#added')!.cornerRadius).toBe(4)
  })
})

describe('an attribute change inside a component reaches its instances without a rebuild (spec §3)', () => {
  const LIB = (extra = '') => `<Page>
<Component name="Chip" status="draft">
  <Frame name="root" layoutMode="HORIZONTAL">
    <Text name="label" characters="Hi"${extra} />
  </Frame>
</Component>
<Frame name="doc">
  <Instance name="one" component="Chip" />
  <Instance name="two" component="Chip" overrides={{ 'root/label': { opacity: 0.2 } }} />
</Frame>
</Page>`

  const VARIANTS = (extra = '') => `<Page>
<Component name="Atlas" status="draft" variants={{ land: ['dots', 'mesh'] }}>
  <Variant land="dots">
    <Frame name="atlas" width={100} height={100} />
  </Variant>
  <Variant land="mesh">
    <Frame name="atlas" width={100} height={100}${extra} />
  </Variant>
</Component>
<Frame name="doc">
  <Instance name="dots" component="Atlas" props={{ land: 'dots' }} />
  <Instance name="mesh" component="Atlas" props={{ land: 'mesh' }} />
</Frame>
</Page>`

  /** The resolver every instance needs; the diff itself reads the `component` attribute directly. */
  const optionsFor = (d: ReturnType<typeof doc>) => {
    const components = new Map(
      d.tree.children.filter((n) => n.element === 'Component').map((n) => [n.name, n]),
    )
    return { resolveComponent: (name: string) => components.get(name) }
  }
  const scene = (d: ReturnType<typeof doc>) => toSceneGraph(d, optionsFor(d))

  const sameAs = (
    incremental: ReturnType<typeof toSceneGraph>,
    rebuilt: ReturnType<typeof toSceneGraph>,
    ids: string[],
  ) => {
    for (const id of ids) {
      const a = incremental.graph.getNode(id)
      const b = rebuilt.graph.getNode(id)
      expect(a, id).toBeDefined()
      expect(b, id).toBeDefined()
      expect({ id, visible: a!.visible, opacity: a!.opacity, text: a!.text }).toEqual({
        id,
        visible: b!.visible,
        opacity: b!.opacity,
        text: b!.text,
      })
    }
  }

  it('does not demand a rebuild, and updates the definition node and every instance copy', () => {
    const before = doc(LIB())
    const after = doc(LIB(' visible={false}'))
    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    const live = scene(before)
    applyChanges(live, changes!, optionsFor(after))
    sameAs(live, scene(after), ['Chip#root/label', 'doc#one/root/label', 'doc#two/root/label'])
    expect(live.graph.getNode('doc#one/root/label')!.visible).toBe(false)
  })

  it('leaves a property the instance overrides alone', () => {
    const before = doc(LIB())
    const after = doc(LIB(' opacity={0.9}'))
    const live = scene(before)
    applyChanges(live, diffDocuments(before, after)!, optionsFor(after))
    expect(live.graph.getNode('doc#one/root/label')!.opacity).toBe(0.9)
    expect(live.graph.getNode('doc#two/root/label')!.opacity).toBe(0.2)
    sameAs(live, scene(after), ['doc#one/root/label', 'doc#two/root/label'])
  })

  it('touches only the instances that picked the changed variant', () => {
    const before = doc(VARIANTS())
    const after = doc(VARIANTS(' visible={false}'))
    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    const live = scene(before)
    applyChanges(live, changes!, optionsFor(after))
    expect(live.graph.getNode('doc#mesh/atlas')!.visible).toBe(false)
    expect(live.graph.getNode('doc#dots/atlas')!.visible).toBe(true)
    sameAs(live, scene(after), ['doc#mesh/atlas', 'doc#dots/atlas'])
  })

  it('re-lays out only what moved, and lands where a full rebuild would', () => {
    const HUG = (extra = '') => `<Page>
<Component name="Row" status="draft">
  <Frame name="root" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO" itemSpacing={4}>
    <Rectangle name="a" width={10} height={10} />
    <Rectangle name="b" width={30} height={10}${extra} />
  </Frame>
</Component>
<Frame name="doc" layoutMode="VERTICAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO">
  <Instance name="one" component="Row" />
  <Frame name="after" width={5} height={5} />
</Frame>
</Page>`
    const before = doc(HUG())
    const after = doc(HUG(' visible={false}'))
    const live = scene(before)
    const changes = diffDocuments(before, after)!
    applyChanges(live, changes, optionsFor(after))
    const rebuilt = scene(after)
    // Not the hidden node itself: the layout engine skips hidden children, so a
    // rebuild leaves it at the constructed default while the live graph keeps
    // its last position — neither is drawn.
    for (const id of [
      'Row#root',
      'doc#one',
      'doc#one/root',
      'doc#one/root/a',
      'doc',
      'doc#after',
    ]) {
      const a = live.graph.getNode(id)!
      const b = rebuilt.graph.getNode(id)!
      expect({ id, x: a.x, y: a.y, w: a.width, h: a.height }).toEqual({
        id,
        x: b.x,
        y: b.y,
        w: b.width,
        h: b.height,
      })
    }
  })

  it('still rebuilds when structure inside the component moves, or an instance changes', () => {
    const before = doc(LIB())
    expect(
      diffDocuments(before, doc(LIB().replace('<Text name="label" characters="Hi" />', ''))),
    ).toBeNull()
    // An instance's own look (x, visible, opacity) is an update; what it expands is a rebuild.
    expect(
      diffDocuments(before, doc(LIB().replace('component="Chip" />', 'component="Chip" x={4} />'))),
    ).not.toBeNull()
    expect(
      diffDocuments(
        before,
        doc(LIB().replace('component="Chip" />', 'component="Chip" props={{ tone: \'x\' }} />')),
      ),
    ).toBeNull()
  })

  it('is empty for identical documents even when a component holds instances of another', () => {
    const NESTED = `<Page>
<Component name="Chip" status="draft">
  <Frame name="root">
    <Text name="label" characters="Hi" />
  </Frame>
</Component>
<Component name="Card" status="draft">
  <Frame name="root" cornerRadius={2}>
    <Instance name="chip" component="Chip" />
  </Frame>
</Component>
<Frame name="doc">
  <Instance name="card" component="Card" />
</Frame>
</Page>`
    expect(diffDocuments(doc(NESTED), doc(NESTED))).toEqual([])
    // A change inside Card reaches Card's copies; Card is not itself nested.
    const changed = diffDocuments(
      doc(NESTED),
      doc(NESTED.replace('cornerRadius={2}', 'cornerRadius={9}')),
    )
    expect(changed).not.toBeNull()
    expect(changed!.map((c) => c.kind)).toEqual(['update', 'update-generated'])
  })

  it('still rebuilds when the changed component is instanced from inside another component', () => {
    const NESTED = (extra = '') => `<Page>
<Component name="Chip" status="draft">
  <Frame name="root">
    <Text name="label" characters="Hi"${extra} />
  </Frame>
</Component>
<Component name="Card" status="draft">
  <Frame name="root">
    <Instance name="chip" component="Chip" />
  </Frame>
</Component>
<Frame name="doc">
  <Instance name="card" component="Card" />
</Frame>
</Page>`
    expect(diffDocuments(doc(NESTED()), doc(NESTED(' visible={false}')))).toBeNull()
  })
})

describe('diffing a predicted document', () => {
  it('skips shared nodes by identity and still reports the change', () => {
    const before = doc(BASE)
    const after = predictDocument(before, [
      { op: 'set', address: 'demo#root/a', prop: 'characters', value: 'Changed' },
    ])
    expect(diffDocuments(before, after)).toEqual([
      { kind: 'update', address: 'demo#root/a', props: { text: 'Changed' } },
    ])
  })
})

describe('diffing an incrementally re-parsed document', () => {
  it('skips shifted copies by their attribute text and still reports the change', () => {
    const before = doc(BASE)
    const after = applyPatchesIncremental(before, [
      { op: 'set', address: 'demo#root/a', prop: 'characters', value: 'A much longer label' },
    ]).doc
    // `b` follows `a` in the file, so its offsets moved and it is a fresh object.
    expect(after.tree.children[0]!.children[0]!.children[1]).not.toBe(
      before.tree.children[0]!.children[0]!.children[1],
    )
    expect(diffDocuments(before, after)).toEqual([
      { kind: 'update', address: 'demo#root/a', props: { text: 'A much longer label' } },
    ])
  })
})

describe('an instance’s own attributes, and a definition root’s, update without a rebuild (spec §3)', () => {
  const LIB = (instanceExtra = '', rootExtra = '') => `<Page>
<Component name="Chip" status="draft"${rootExtra}>
  <Frame name="root" layoutMode="HORIZONTAL" width={80} height={20}>
    <Text name="label" characters="Hi" />
  </Frame>
</Component>
<Frame name="doc">
  <Instance name="one" component="Chip"${instanceExtra} />
  <Instance name="two" component="Chip" />
</Frame>
</Page>`
  const optionsFor = (d: ReturnType<typeof doc>) => {
    const components = new Map(
      d.tree.children.filter((n) => n.element === 'Component').map((n) => [n.name, n]),
    )
    return { resolveComponent: (name: string) => components.get(name) }
  }
  const scene = (d: ReturnType<typeof doc>) => toSceneGraph(d, optionsFor(d))
  const same = (
    a: ReturnType<typeof toSceneGraph>,
    b: ReturnType<typeof toSceneGraph>,
    ids: string[],
  ) => {
    for (const id of ids) {
      const x = a.graph.getNode(id)!
      const y = b.graph.getNode(id)!
      expect({ id, visible: x.visible, opacity: x.opacity, w: x.width, h: x.height }).toEqual({
        id,
        visible: y.visible,
        opacity: y.opacity,
        w: y.width,
        h: y.height,
      })
    }
  }

  it('hiding an instance is an update to its root, not a rebuild', () => {
    const before = doc(LIB())
    const after = doc(LIB(' visible={false}'))
    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    const live = scene(before)
    applyChanges(live, changes!, optionsFor(after))
    expect(live.graph.getNode('doc#one')!.visible).toBe(false)
    expect(live.graph.getNode('doc#two')!.visible).toBe(true)
    same(live, scene(after), ['doc#one', 'doc#two', 'doc#one/root'])
  })

  it('an instance’s own size override, added then removed, lands where a rebuild would', () => {
    const plain = doc(LIB())
    const sized = doc(LIB(' width={200}'))
    const live = scene(plain)
    applyChanges(live, diffDocuments(plain, sized)!, optionsFor(sized))
    same(live, scene(sized), ['doc#one'])
    applyChanges(live, diffDocuments(sized, plain)!, optionsFor(plain))
    same(live, scene(plain), ['doc#one'])
  })

  it('an attribute on the component itself reaches every instance root', () => {
    const before = doc(LIB())
    const after = doc(LIB('', ' visible={false}'))
    const changes = diffDocuments(before, after)
    expect(changes).not.toBeNull()
    const live = scene(before)
    applyChanges(live, changes!, optionsFor(after))
    same(live, scene(after), ['Chip', 'doc#one', 'doc#two'])
  })

  it('still rebuilds when an instance changes what it expands', () => {
    const before = doc(LIB())
    expect(diffDocuments(before, doc(LIB(" props={{ label: 'x' }}")))).toBeNull()
    expect(
      diffDocuments(
        before,
        doc(
          LIB().replace(
            'component="Chip" />',
            'component="Chip" overrides={{ root: { opacity: 0.5 } }} />',
          ),
        ),
      ),
    ).toBeNull()
  })
})
