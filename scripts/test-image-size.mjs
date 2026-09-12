import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'

// Run in a child process with a deadline: an unpatched parser must not hang CI.
const require = createRequire(import.meta.url)
const base = process.argv[2]
const { ICNS } = require(join(base, 'dist/types/icns.js'))
const { JXL } = require(join(base, 'dist/types/jxl.js'))
const { HEIF } = require(join(base, 'dist/types/heif.js'))
const { findBox } = require(join(base, 'dist/types/utils.js'))
const box = (name, size = 8, payload = Buffer.alloc(0)) => {
  const result = Buffer.alloc(8 + payload.length)
  result.writeUInt32BE(size)
  result.write(name, 4, 'ascii')
  payload.copy(result, 8)
  return result
}
const icon = (...entries) => {
  const body = Buffer.concat(entries)
  const header = Buffer.alloc(8)
  header.write('icns')
  header.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([header, body])
}
// ICNS stores the entry type before the entry size, unlike ISO BMFF boxes.
const entry = (size) => {
  const result = Buffer.alloc(8)
  result.write('icp4')
  result.writeUInt32BE(size, 4)
  return result
}
assert.equal(ICNS.calculate(icon(entry(8))).width, 16)
assert.equal(ICNS.calculate(icon(entry(8), entry(8))).images.length, 2)
for (const size of [0, 1, 7, 9, 0xffffffff]) {
  assert.throws(() => ICNS.calculate(icon(entry(size))), /Invalid ICNS/)
  assert.throws(() => ICNS.calculate(icon(entry(8), entry(size))), /Invalid ICNS/)
}
assert.throws(() => ICNS.calculate(icon(Buffer.from('icp4'))), /Invalid ICNS/)
assert.equal(findBox(box('jxlp', 0), 'jxlp', 0).size, 8)
for (const size of [1, 7, 9, 0xffffffff])
  assert.equal(findBox(box('jxlp', size), 'jxlp', 0), undefined)
assert.equal(findBox(Buffer.alloc(4), 'jxlp', 0), undefined)
const header = Buffer.concat([
  box('JXL ', 12, Buffer.alloc(4)),
  box('ftyp', 12, Buffer.from('jxl ')),
])
assert.equal(JXL.validate(header), true)
assert.throws(() => JXL.calculate(Buffer.concat([header, box('jxlp', 0)])))
assert.throws(() =>
  HEIF.calculate(Buffer.concat([box('ftyp', 12, Buffer.from('heic')), box('meta', 0)])),
)
console.log('Image parser regression checks passed.')
