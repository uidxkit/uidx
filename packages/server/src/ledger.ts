/**
 * Ring buffer of content hashes the server itself just wrote (spec §6.3).
 *
 * The failure it exists to prevent: a canvas edit writes the file, the watcher
 * fires, and the viewer replaces its document mid-gesture — flicker, or a lost
 * drag. If the hash of what the watcher just read is one we put here, the event
 * is our own echo and gets swallowed.
 *
 * The TTL is an assumption about filesystem latency, not a constant of nature.
 * On a slow or network-mounted filesystem an echo can arrive after it expires,
 * at which point the viewer takes a redundant document replacement. That is
 * merely a flicker, never corruption — the client already holds this state.
 */
export const DEFAULT_CAPACITY = 8
export const DEFAULT_TTL_MS = 2_000

interface Entry {
  hash: string
  at: number
}

export class WriteLedger {
  private entries: Entry[] = []

  constructor(
    private readonly capacity = DEFAULT_CAPACITY,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  record(hash: string): void {
    this.entries.push({ hash, at: this.now() })
    if (this.entries.length > this.capacity) {
      this.entries.splice(0, this.entries.length - this.capacity)
    }
  }

  /**
   * True when this content is one of ours. Consumes the entry: a given write
   * produces exactly one watcher event, and leaving it would swallow a genuine
   * external save that happened to restore identical bytes.
   */
  claim(hash: string): boolean {
    this.prune()
    const index = this.entries.findIndex((e) => e.hash === hash)
    if (index === -1) return false
    this.entries.splice(index, 1)
    return true
  }

  get size(): number {
    this.prune()
    return this.entries.length
  }

  private prune(): void {
    const cutoff = this.now() - this.ttlMs
    this.entries = this.entries.filter((e) => e.at > cutoff)
  }
}
