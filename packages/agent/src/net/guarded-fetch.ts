import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

/** A fetch that would not be safe, or did not work, said in words the model can act on. */
export class FetchRefused extends Error {}

/** Bytes read before the body is cut. A page past this is a page the model should not be reading whole. */
const MAX_BYTES = 2_000_000

/** How long one request may take before it is abandoned. */
const TIMEOUT_MS = 15_000

/** Redirects followed before giving up, each re-checked as if it were the original request. */
const MAX_REDIRECTS = 5

/**
 * Address ranges this service must never reach on the model's say-so.
 *
 * The threat is concrete rather than theoretical. This process runs on a
 * designer's own machine, and the URL is chosen by a model that has just been
 * reading web pages — content it does not control and cannot verify. Left
 * unguarded, "fetch this page" reaches the uidx server on 4400, this agent on
 * 4600, Ollama on 11434, a router's admin page, and every cloud metadata
 * endpoint that ever leaked a credential.
 *
 * Blocked by resolved address rather than by hostname, because a hostname is
 * an attacker's to choose: `evil.test` resolving to 127.0.0.1 defeats any
 * check that only reads the string.
 */
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = ip.toLowerCase()
    if (v6 === '::1' || v6 === '::') return true
    // Unique-local (fc00::/7) and link-local (fe80::/10).
    if (/^f[cd]/.test(v6) || /^fe[89ab]/.test(v6)) return true
    // IPv4-mapped, e.g. ::ffff:127.0.0.1 — the v4 rules decide.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    return mapped ? isPrivate(mapped[1]!) : false
  }

  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n))) return true
  const [a, b] = parts as [number, number, number, number]
  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, and cloud metadata at 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  )
}

/**
 * How a hostname becomes addresses. Injectable because the guard resolves
 * *before* it fetches: a stubbed `fetch` alone would still leave these tests
 * making live DNS queries, which is a network dependency hiding inside a unit
 * test — and duly showed up as failures under parallel load while every case
 * passed alone.
 */
export type LookupImpl = (host: string) => Promise<{ address: string }[]>

const dnsLookup: LookupImpl = (host) => lookup(host, { all: true })

export interface FetchOptions {
  fetchImpl?: typeof fetch
  lookupImpl?: LookupImpl
}

/** Refuses a url this service must not go to, or returns it parsed. */
async function checkUrl(raw: string, resolve: LookupImpl): Promise<URL> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchRefused(`${raw} is not a url`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new FetchRefused(`${url.protocol} is not fetchable — use http or https`)
  }

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [{ address: host }] : await resolve(host)
  for (const { address } of addresses) {
    if (isPrivate(address)) {
      throw new FetchRefused(
        `${url.hostname} resolves to ${address}, on this machine or its private network. This tool only reaches the public internet.`,
      )
    }
  }
  return url
}

export interface Fetched {
  url: string
  contentType: string
  body: string
  /** The raw bytes, for a caller after an image rather than words. */
  bytes: Uint8Array
  /** True when the body was cut at `MAX_BYTES` — text survives a cut, an image does not. */
  truncated: boolean
}

/**
 * Fetches a public url, following redirects by hand so every hop is checked.
 *
 * `redirect: 'follow'` would let a public url bounce to `127.0.0.1` with the
 * guard applied only to the first address — which is the whole attack, done
 * politely. Each hop goes back through `checkUrl`.
 */
export async function guardedFetch(raw: string, options: FetchOptions = {}): Promise<Fetched> {
  const fetchImpl = options.fetchImpl ?? fetch
  const resolve = options.lookupImpl ?? dnsLookup
  let target = await checkUrl(raw, resolve)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let response: Response
    try {
      response = await fetchImpl(target.href, {
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          accept:
            'text/html,text/plain,application/json;q=0.9,image/png,image/jpeg,image/webp;q=0.8',
        },
      })
    } catch (error) {
      throw new FetchRefused(
        `could not reach ${target.href} — ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      clearTimeout(timer)
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new FetchRefused(`${target.href} redirected without saying where`)
      target = await checkUrl(new URL(location, target).href, resolve)
      continue
    }
    if (!response.ok) {
      throw new FetchRefused(`${target.href} answered ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    const bytes = new Uint8Array(buffer).subarray(0, MAX_BYTES)
    return {
      url: target.href,
      contentType: response.headers.get('content-type') ?? '',
      body: new TextDecoder().decode(bytes),
      bytes,
      truncated: buffer.byteLength > MAX_BYTES,
    }
  }
  throw new FetchRefused(`${raw} redirected more than ${MAX_REDIRECTS} times`)
}

/**
 * The page's own content, when it says where that is.
 *
 * Measured against the real Open UI switch explainer: a naive strip of the
 * whole document returns four hundred characters of site navigation — every
 * proposal in their sidebar — before a word about switches. Under a read
 * budget the model can spend its whole allowance on a menu. `<main>` and
 * `<article>` are how a documentation site says "the page is this bit", and
 * almost all of them do; a page that says nothing falls back to the lot.
 */
function mainRegion(html: string): string {
  for (const tag of ['main', 'article']) {
    const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i').exec(html)
    if (match?.[1] && match[1].length > 200) return match[1]
  }
  return html
}

/**
 * HTML reduced to the words on the page.
 *
 * Deliberately a few regexes rather than a parser: the model needs the prose,
 * not the document, and a dependency for that would be the third party this
 * tool exists to avoid. Script and style go first — their contents are text to
 * a tag-stripper and noise to a reader.
 */
export function readableText(html: string): string {
  return (
    mainRegion(html)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      // Block-level tags become newlines so headings and list items stay apart;
      // everything else collapses, or the text arrives as one wall.
      .replace(/<\/(p|div|section|article|h[1-6]|li|tr|blockquote|pre)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/[ \t]+/g, ' ')
      // A stripped tag leaves a space behind, so every line would otherwise
      // start with one.
      .replace(/[ \t]*\n[ \t]*/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}
