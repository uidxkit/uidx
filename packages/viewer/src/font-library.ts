import { ref, shallowRef, type ComputedRef, type InjectionKey } from 'vue'
import { fontManager } from '@open-pencil/core'
import { mergeCoverage, readGlyphCoverage, type GlyphCoverage } from '@uidx/schema'

export interface ProjectFont {
  id: string
  family: string
  style: string
  weight: number
  italic: boolean
  source: 'google' | 'custom'
  file: string
}

export const fontsInFileKey: InjectionKey<ComputedRef<string[]>> = Symbol('fonts-in-file')
export const openFontsKey: InjectionKey<() => void> = Symbol('open-fonts')
export const projectFonts = shallowRef<ProjectFont[]>([])
export const fontGeneration = ref(0)
export const fontLibraryError = ref('')
const coverage = new Map<string, GlyphCoverage>()
const loaded = new Map<string, ArrayBuffer>()
let initializing: Promise<void> | undefined

export function registerFontCoverage(family: string, bytes: ArrayBuffer): void {
  const value = readGlyphCoverage(bytes)
  if (value) {
    const key = family.toLowerCase(),
      previous = coverage.get(key)
    coverage.set(key, previous ? mergeCoverage([previous, value]) : value)
  }
}

export function coverageForFont(family: string): GlyphCoverage | undefined {
  return coverage.get(family.toLowerCase())
}

async function request<T>(path = '', options?: RequestInit): Promise<T> {
  const response = await fetch(`/__uidx/fonts${path}`, {
    ...options,
    signal: AbortSignal.timeout(45_000),
  })
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('The font service is unavailable. Restart the uidx server, then retry.')
  }
  const data = (await response.json()) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? 'Could not load the font library.')
  return data
}

async function load(font: ProjectFont): Promise<void> {
  if (loaded.has(font.id)) return
  const response = await fetch(`/__uidx/fonts/${font.id}`, { signal: AbortSignal.timeout(15_000) })
  if (response.headers.get('content-type')?.includes('text/html'))
    throw new Error('The font service is unavailable. Restart the uidx server, then retry.')
  if (!response.ok)
    throw new Error(`Could not load ${font.family} ${font.style}. Reimport the font file.`)
  const bytes = await response.arrayBuffer()
  registerFontCoverage(font.family, bytes)
  fontManager.markLoaded(font.family, font.style, bytes)
  loaded.set(font.id, bytes)
  fontGeneration.value++
}

export async function refreshFontLibrary(): Promise<void> {
  fontLibraryError.value = ''
  try {
    projectFonts.value = await request<ProjectFont[]>()
    const results = await Promise.allSettled(projectFonts.value.map(load))
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (errors.length)
      throw new Error(
        errors
          .map((r) => String(r.reason instanceof Error ? r.reason.message : r.reason))
          .join(' '),
      )
  } catch (error) {
    fontLibraryError.value =
      error instanceof Error ? error.message : 'Could not load project fonts.'
    throw error
  }
}

export function initializeFontLibrary(): Promise<void> {
  initializing ??= refreshFontLibrary().catch(() => {
    initializing = undefined
  })
  return initializing
}

export async function importGoogleFont(
  family: string,
  weight: number,
  italic: boolean,
): Promise<ProjectFont> {
  const font = await request<ProjectFont>('/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ family, weight, italic }),
  })
  await refreshFontLibrary()
  return font
}

export async function uploadFont(file: File): Promise<ProjectFont> {
  if (!/\.(ttf|otf)$/i.test(file.name)) throw new Error('Choose a static .ttf or .otf font file.')
  if (file.size > 20 * 1024 * 1024) throw new Error('Font files must be smaller than 20 MB.')
  const font = await request<ProjectFont>('/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  })
  await refreshFontLibrary()
  return font
}

export async function removeFont(id: string): Promise<void> {
  await request(`/${id}`, { method: 'DELETE' })
  projectFonts.value = projectFonts.value.filter((font) => font.id !== id)
}

/** Only serve actual faces. Missing families must not be cached as Inter. */
export async function projectFontBytes(family: string, style: string): Promise<ArrayBuffer | null> {
  await initializeFontLibrary()
  const font = projectFonts.value.find(
    (entry) => entry.family.toLowerCase() === family.toLowerCase() && entry.style === style,
  )
  return font ? (loaded.get(font.id) ?? null) : null
}
