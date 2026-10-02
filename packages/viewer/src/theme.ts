import { ref, watch } from 'vue'

/**
 * Light or dark chrome. The choice is the viewer's, remembered per browser;
 * until one is made the editor is dark, as design tools are. Applied as
 * `data-theme` on the root, where `theme.css` redefines its tokens, so no
 * component knows which theme it is in.
 */
export type ThemeChoice = 'light' | 'dark'

const KEY = 'uidx.theme'

function stored(): ThemeChoice | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export const theme = ref<ThemeChoice>(stored() ?? 'dark')

export function setTheme(next: ThemeChoice): void {
  theme.value = next
  try {
    localStorage.setItem(KEY, next)
  } catch {
    // A browser that refuses storage still switches for this visit.
  }
}

watch(
  theme,
  (value) => {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = value
  },
  { immediate: true },
)
