import { isAbsolute, resolve as resolvePath, sep } from 'node:path'
import picomatch from 'picomatch'

export class JailError extends Error {}

export const AGENT_DIR = '.uidx-agent'

/** Resolve a workspace-relative path, refusing anything that leaves the root. */
export function resolveInside(root: string, relPath: string): string {
  if (isAbsolute(relPath)) {
    throw new JailError(`${relPath}: paths must be relative to the document root`)
  }
  const absolute = resolvePath(root, relPath)
  if (absolute !== root && !absolute.startsWith(root.endsWith(sep) ? root : root + sep)) {
    throw new JailError(`${relPath}: outside the document root`)
  }
  return absolute
}

/**
 * The toolset is the sandbox: only `.uidx` files the manifest already claims
 * can be written, and never the harness's own bookkeeping.
 */
export function assertWritable(root: string, globs: readonly string[], relPath: string): void {
  resolveInside(root, relPath)

  if (relPath.split('/')[0] === AGENT_DIR) {
    throw new JailError(`${relPath}: ${AGENT_DIR} belongs to the harness, not the document`)
  }
  if (!relPath.endsWith('.uidx')) {
    throw new JailError(`${relPath}: only .uidx files can be written`)
  }
  if (!picomatch(globs as string[])(relPath)) {
    throw new JailError(`${relPath}: not covered by the manifest files globs (${globs.join(', ')})`)
  }
}
