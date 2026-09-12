import { describe, expect, it, vi } from 'vitest'
import { parseOrThrow } from '@uidx/format'

import { createAssetStore } from '../src/asset-store'

const doc = (srcs: string[]) =>
  parseOrThrow(
    `---\nid: a\n---\n\n## Visual Contract\n\n<Page>\n${srcs
      .map((src, i) => `  <Rectangle name="r${i}" fills={[{ type: 'IMAGE', src: '${src}' }]} />`)
      .join('\n')}\n</Page>\n`,
  )

const bytes = (s: string) => new TextEncoder().encode(s)

describe('the asset store', () => {
  it('loads what a document references and keys it by hash', async () => {
    const store = createAssetStore(async (src) => bytes(`bytes:${src}`))
    expect(await store.load(doc(['assets/a.png']))).toBe(true)
    expect(store.hashOf('assets/a.png')).toBeTypeOf('string')
    expect(store.entries()).toHaveLength(1)
  })

  it('gives identical bytes the same hash, so two pages share one image', async () => {
    const store = createAssetStore(async () => bytes('same'))
    await store.load(doc(['assets/a.png', 'images/b.png']))
    const [a, b] = store.entries()
    expect(a!.hash).toBe(b!.hash)
  })

  it('fetches each path once, however many times it is referenced', async () => {
    const fetcher = vi.fn(async () => bytes('x'))
    const store = createAssetStore(fetcher)
    await store.load(doc(['assets/a.png', 'assets/a.png']))
    await store.load(doc(['assets/a.png']))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('reports what it could not load instead of pretending', async () => {
    const store = createAssetStore(async () => null)
    await store.load(doc(['assets/gone.png']))
    expect(store.missing()).toEqual(['assets/gone.png'])
    expect(store.hashOf('assets/gone.png')).toBeUndefined()
  })

  /**
   * The usual reason a reference fails is that the author has not saved the
   * file yet, and the next document is exactly when they have.
   */
  it('retries a failure on the next document rather than giving up', async () => {
    let available = false
    const store = createAssetStore(async () => (available ? bytes('now') : null))
    await store.load(doc(['assets/late.png']))
    expect(store.missing()).toHaveLength(1)

    available = true
    expect(await store.load(doc(['assets/late.png']))).toBe(true)
    expect(store.missing()).toEqual([])
  })

  it('says nothing changed when there was nothing new to fetch', async () => {
    const store = createAssetStore(async () => bytes('x'))
    await store.load(doc(['assets/a.png']))
    expect(await store.load(doc(['assets/a.png']))).toBe(false)
  })

  it('forgets a reference the document no longer makes', async () => {
    const store = createAssetStore(async () => null)
    await store.load(doc(['assets/gone.png']))
    await store.load(doc([]))
    expect(store.missing()).toEqual([])
  })

  it('survives a fetch that throws', async () => {
    const store = createAssetStore(async () => {
      throw new Error('network')
    })
    await expect(store.load(doc(['a.png']))).resolves.toBe(false)
    expect(store.missing()).toEqual(['a.png'])
  })

  it('re-fetches a reference it has been told to forget', async () => {
    let served = 'first'
    let calls = 0
    const store = createAssetStore(async () => {
      calls += 1
      return bytes(served)
    })
    const target = doc(['assets/logo.png'])

    await store.load(target)
    const before = store.hashOf('assets/logo.png')

    expect(store.invalidate('assets/logo.png')).toBe(true)
    served = 'second'
    await store.load(target)

    // A new hash, because the bytes changed — and it is the hash the graph is
    // keyed by, so this is what actually makes the renderer draw the new image.
    expect(calls).toBe(2)
    expect(store.hashOf('assets/logo.png')).not.toBe(before)
  })

  it('answers false for a reference it never held', async () => {
    const store = createAssetStore(async () => new Uint8Array([1]))

    expect(store.invalidate('assets/never.png')).toBe(false)
  })

  it('stops calling a forgotten reference missing once it loads', async () => {
    let bytes: Uint8Array | null = null
    const store = createAssetStore(async () => bytes)
    const target = doc(['assets/late.png'])

    await store.load(target)
    expect(store.missing()).toEqual(['assets/late.png'])

    // The author saved the artwork. `invalidate` clears the failure as well as
    // the bytes, or the canvas would keep reporting a file that is now there.
    bytes = new Uint8Array([1, 2, 3])
    store.invalidate('assets/late.png')
    await store.load(target)

    expect(store.missing()).toEqual([])
  })
})
