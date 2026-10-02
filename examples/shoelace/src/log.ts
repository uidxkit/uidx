const panel = () => document.getElementById('log')!

/** Appends one line to the on-page event log (newest last). */
export function log(line: string): void {
  const out = panel()
  out.textContent += `${new Date().toLocaleTimeString()}  ${line}\n`
  out.scrollTop = out.scrollHeight
}
