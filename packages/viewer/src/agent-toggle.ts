import { ref, type Ref } from 'vue'

import { probeAgent, type AgentStatus } from './agent-client'

export interface AgentToggle {
  open: Ref<boolean>
  status: Ref<AgentStatus>
  probe(): Promise<void>
  toggle(): void
  /**
   * Starts the repeating health probe: once promptly, then a
   * self-rescheduling timer with exponential backoff (see below).
   */
  start(): void
  /** Stops the repeating probe and clears whatever timer is outstanding. */
  stop(): void
}

/**
 * The service is optional, so most users never run it — indefinitely. A
 * fixed ten-second `setInterval` would have the browser itself, not
 * JavaScript, print a connection-refused error to the console and the
 * Network tab every ten seconds forever, which breaks the one promise this
 * feature makes: that a missing service costs nothing. Backing off while it
 * stays unreachable, and snapping back to the fast interval the moment it
 * answers, is what keeps that promise while still noticing quickly when the
 * service does appear.
 */
const BASE_DELAY = 10_000
const MAX_DELAY = 300_000

/**
 * The panel is optional: with no service running the icon stays inert rather
 * than opening onto an error.
 */
export function createAgentToggle(deps: { url: string; fetchImpl?: typeof fetch }): AgentToggle {
  const open = ref(false)
  const status = ref<AgentStatus>({ online: false })

  let timer: ReturnType<typeof setTimeout> | null = null
  // Each `start()` claims a new generation and captures it in its own
  // `tick` chain's closure below; `stop()` claims one too. A chain whose
  // captured generation no longer matches the current one is stale and must
  // not schedule anything further. This is what `clearTimeout` structurally
  // cannot cover: a probe already in flight when `stop`/`start` runs has no
  // timer yet to clear, so without this guard a stale chain's probe would
  // resolve later, see nothing telling it to stop, and schedule its own
  // timeout — a second, uncancellable polling chain running alongside
  // whatever `start()` began next.
  let generation = 0

  async function probe(): Promise<void> {
    status.value = await probeAgent(deps.url, deps.fetchImpl)
    if (!status.value.online) open.value = false
  }

  function clearPending(): void {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    open,
    status,
    probe,
    toggle() {
      if (!status.value.online) return
      open.value = !open.value
    },
    start() {
      generation += 1
      const myGeneration = generation
      clearPending()

      // Per-chain, not shared: a stale chain (even one that ran for a while
      // before being superseded) must never skew a fresh chain's backoff.
      let consecutiveFailures = 0

      async function tick(): Promise<void> {
        await probe()
        if (myGeneration !== generation) return
        consecutiveFailures = status.value.online ? 0 : consecutiveFailures + 1
        const wait = Math.min(BASE_DELAY * 2 ** Math.max(consecutiveFailures - 1, 0), MAX_DELAY)
        timer = setTimeout(() => void tick(), wait)
      }

      void tick()
    },
    stop() {
      generation += 1
      clearPending()
    },
  }
}
