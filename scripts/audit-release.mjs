import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { verifyDependencyFixes } from './check-dependency-fixes.mjs'

// Audit development dependencies too: several are compiled into the viewer.
verifyDependencyFixes()
const result = spawnSync('pnpm', ['audit', '--json'], {
  encoding: 'utf8',
  maxBuffer: 16 * 1024 * 1024,
})
assert.ifError(result.error)
const report = JSON.parse(result.stdout)
assert(report.advisories && report.metadata, `Audit failed: ${result.stdout} ${result.stderr}`)
const backported = new Set(['GHSA-w3rx-r6r6-pgpr', 'GHSA-5p2g-fcmc-qvqq'])
let failures = 0
for (const advisory of Object.values(report.advisories)) {
  const id = advisory.github_advisory_id
  const covered =
    backported.has(id) &&
    advisory.module_name === 'image-size' &&
    advisory.findings.every(
      (finding) =>
        finding.version === '1.2.1' &&
        finding.paths.every((path) =>
          / > @open-pencil\/core@0\.14\.0 > pptxgenjs@4\.0\.1 > image-size@1\.2\.1$/.test(path),
        ),
    )
  if (covered) {
    console.log(
      `${id}: covered by the locally verified image-size backport (upstream version remains flagged).`,
    )
  } else if (['high', 'critical'].includes(advisory.severity)) {
    console.error(`${advisory.severity}: ${advisory.title} — ${advisory.url}`)
    failures++
  } else {
    console.log(`${advisory.severity}: ${advisory.title} — ${advisory.url}`)
  }
}
assert.equal(failures, 0, 'Unresolved high/critical dependency advisories block release')
console.log('Release dependency audit passed; any accepted backports are listed above.')
