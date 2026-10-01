import type { InjectionKey } from 'vue'

/**
 * Draws one component, small, for a picker row: resolves an image URL, or
 * null when there is nothing to draw. Provided by the shell, which holds the
 * thumbnailer and every page a component may live on; a picker mounted
 * without it (a test, a story) falls back to the component glyph.
 */
export type ComponentPreview = (component: string) => Promise<string | null>

export const componentPreviewKey: InjectionKey<ComponentPreview> = Symbol('component-preview')
