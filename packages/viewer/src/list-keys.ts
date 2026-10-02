/**
 * The keys a searchable list promises, for the popups that pick a variable:
 * ↓ and ↑ walk the rows (↑ from the first returns to the search), and Enter
 * in the search picks the first match — type "accent", press Enter. A
 * focused row picks itself on Enter already, a button natively.
 */
export function onListKeys(
  event: KeyboardEvent,
  root: HTMLElement | null,
  search: HTMLInputElement | null,
): void {
  const list = [...(root?.querySelectorAll<HTMLElement>('.popup-row') ?? [])]
  const at = list.indexOf(document.activeElement as HTMLElement)
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const next = event.key === 'ArrowDown' ? at + 1 : at - 1
    if (next < 0) search?.focus()
    else list[Math.min(next, list.length - 1)]?.focus()
  } else if (event.key === 'Enter' && search && document.activeElement === search) {
    event.preventDefault()
    list[0]?.click()
  }
}
