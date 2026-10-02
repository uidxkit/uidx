/**
 * Puts the caret in a number field's edit box the moment it appears.
 *
 * `NumberFieldRoot` focuses the input only when it renders it itself, through
 * `NumberFieldInput`; these fields render their own `<input>` in its slot, so
 * a click swapped the number for a box that never took focus — and the digits
 * typed next went to whatever still had it, renaming a layer in the tree.
 * Selected as well, so typing replaces the value rather than appending.
 */
export function focusEdit(vnode: { el: unknown }): void {
  const input = vnode.el
  if (!(input instanceof HTMLInputElement)) return
  input.focus()
  setTimeout(() => input.select(), 0)
}
