import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAgentToggle } from '../src/agent-toggle'

describe('createAgentToggle', () => {
  it('starts closed and offline, so a missing service costs nothing', () => {
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl: async () => new Response('x') })
    expect(toggle.open.value).toBe(false)
    expect(toggle.status.value).toEqual({ online: false })
  })

  it('goes online once the probe answers', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, version: '1' })))
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })
    await toggle.probe()
    expect(toggle.status.value).toEqual({ online: true, version: '1' })
  })

  it('opens and closes', async () => {
    const toggle = createAgentToggle({
      url: 'http://x',
      fetchImpl: async () => new Response(JSON.stringify({ ok: true, version: '1' })),
    })
    await toggle.probe()
    toggle.toggle()
    expect(toggle.open.value).toBe(true)
    toggle.toggle()
    expect(toggle.open.value).toBe(false)
  })

  it('refuses to open while the service is offline', async () => {
    const toggle = createAgentToggle({
      url: 'http://x',
      fetchImpl: async () => {
        throw new Error('down')
      },
    })
    await toggle.probe()
    toggle.toggle()
    expect(toggle.open.value).toBe(false)
  })
})

/**
 * The optional service means most users never run it, indefinitely. A fixed
 * ten-second `setInterval` would have the browser itself — not JavaScript —
 * print a connection-refused error to the console and the Network tab every
 * ten seconds forever, which breaks the promise that a missing service costs
 * nothing. These tests drive the self-rescheduling timer with fake timers so
 * the backoff is checked without any of them taking wall-clock minutes.
 */
describe('createAgentToggle backoff', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('lengthens the wait after each consecutive failure', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // The wait after the first failure is the base interval, ten seconds.
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Each further failure doubles the wait: twenty seconds, then forty.
    await vi.advanceTimersByTimeAsync(19_999)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    await vi.advanceTimersByTimeAsync(39_999)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(4)

    toggle.stop()
  })

  it('resets to the base interval once the service answers again', async () => {
    let online = false
    const fetchImpl = vi.fn(async () => {
      if (!online) throw new Error('down')
      return new Response(JSON.stringify({ ok: true, version: '1' }))
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start()
    await vi.advanceTimersByTimeAsync(0) // attempt 1: offline
    await vi.advanceTimersByTimeAsync(10_000) // attempt 2: offline, wait doubles to 20s
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    online = true
    await vi.advanceTimersByTimeAsync(20_000) // attempt 3: online, wait resets to 10s
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(toggle.status.value).toEqual({ online: true, version: '1' })

    // Back to the fast interval rather than the forty seconds a fourth
    // consecutive failure would have earned.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(fetchImpl).toHaveBeenCalledTimes(4)

    toggle.stop()
  })

  it('clears the pending timer on stop, so no probe fires afterwards', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('down')
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    toggle.stop()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('clears the timer even when stop is called while a probe is in flight', async () => {
    let resolveProbe: (() => void) | undefined
    const fetchImpl = vi.fn(async () => {
      await new Promise<void>((resolve) => {
        resolveProbe = resolve
      })
      throw new Error('down')
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // Stop lands while the first probe is still awaiting its response.
    toggle.stop()
    resolveProbe?.()
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('leaves exactly one polling chain when stop and start race an in-flight probe', async () => {
    let resolveFirst: (() => void) | undefined
    let callCount = 0
    const fetchImpl = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        // The very first probe is held open, simulating it still being in
        // flight when `stop` and a second `start` both run before it settles.
        await new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      throw new Error('down')
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start() // chain A begins; its immediate probe is now in flight
    toggle.stop() // chain A has no timer yet, so there is nothing to cancel
    toggle.start() // chain B begins, with its own immediate probe

    await vi.advanceTimersByTimeAsync(0)
    // Chain B's own immediate probe has already resolved (call 2); chain
    // A's stale probe (call 1) is still the one being held open.
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Chain A's stale probe finally resolves, well after it was superseded.
    resolveFirst?.()
    await vi.advanceTimersByTimeAsync(0)
    // Still 2: a superseded chain must not schedule a further call.
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // The next few intervals happen to land the same whether one chain or two
    // are alive — a stray orphaned chain's own doubling schedule can coincide
    // with the live chain's by sheer chance this early, which is exactly why
    // a short race window is not a trustworthy witness on its own.
    await vi.advanceTimersByTimeAsync(10_000) // chain B: attempt 2 (call 3)
    await vi.advanceTimersByTimeAsync(20_000) // chain B: attempt 3 (call 4)
    await vi.advanceTimersByTimeAsync(40_000) // chain B: attempt 4 (call 5)
    expect(fetchImpl).toHaveBeenCalledTimes(5)

    // Push deep into backoff, well past the five-minute cap. A surviving
    // second chain settles into firing on its own roughly every five minutes,
    // so over four hours it adds dozens of calls a single chain cannot.
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 - 70_000)
    expect(fetchImpl).toHaveBeenCalledTimes(53)

    toggle.stop()
  })

  it('leaves no surviving chain after a final stop, even across a stop/start race', async () => {
    let resolveFirst: (() => void) | undefined
    let callCount = 0
    const fetchImpl = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      throw new Error('down')
    })
    const toggle = createAgentToggle({ url: 'http://x', fetchImpl })

    toggle.start() // chain A begins; its immediate probe is now in flight
    toggle.stop()
    toggle.start() // chain B begins

    await vi.advanceTimersByTimeAsync(0)
    resolveFirst?.() // chain A's stale probe resolves after the race above
    await vi.advanceTimersByTimeAsync(0)

    toggle.stop() // the final stop: whatever is still live is cancelled here

    const callsAtStop = fetchImpl.mock.calls.length
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(fetchImpl).toHaveBeenCalledTimes(callsAtStop)
  })
})
