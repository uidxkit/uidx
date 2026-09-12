import { describe, expect, it } from 'vitest'

import { assertWritable, JailError, resolveInside } from '../src/edit/jail.js'

describe('resolveInside', () => {
  it('resolves a relative path against the document root', () => {
    expect(resolveInside('/work/doc', 'pages/home.uidx')).toBe('/work/doc/pages/home.uidx')
  })

  it('refuses to climb out of the root', () => {
    expect(() => resolveInside('/work/doc', '../secrets.uidx')).toThrow(JailError)
  })

  it('refuses an absolute path', () => {
    expect(() => resolveInside('/work/doc', '/etc/passwd')).toThrow(JailError)
  })

  it('refuses a path that escapes through a symlink-looking segment', () => {
    expect(() => resolveInside('/work/doc', 'pages/../../out.uidx')).toThrow(JailError)
  })

  it('refuses a path that escapes into a sibling directory sharing the root name as a prefix', () => {
    expect(() => resolveInside('/work/doc', '../doc-evil/secret.uidx')).toThrow(JailError)
  })
})

describe('assertWritable', () => {
  const globs = ['**/*.uidx']

  it('accepts a uidx file that the manifest globs cover', () => {
    expect(() => assertWritable('/work/doc', globs, 'pages/home.uidx')).not.toThrow()
  })

  it('refuses anything that is not a uidx file', () => {
    expect(() => assertWritable('/work/doc', globs, 'notes.md')).toThrow(/\.uidx/)
  })

  it('refuses a uidx file outside the manifest globs', () => {
    expect(() => assertWritable('/work/doc', ['design/**/*.uidx'], 'other/home.uidx')).toThrow(
      /manifest/,
    )
  })

  it('refuses to write into the agent own directory', () => {
    expect(() => assertWritable('/work/doc', globs, '.uidx-agent/notes.uidx')).toThrow(JailError)
  })
})
