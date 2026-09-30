import { CODES, diagnostic, type Diagnostic } from '@uidx/format'
import { manifestTags, partTag, type ComponentModel, type Manifest } from './model.js'

/**
 * The declared contract against the headless implementation (ADR 0013 §4).
 *
 * The uidx file is authoritative; the element is proven to conform: every
 * attribute the element exposes is a prop the contract declares, every event
 * it dispatches is declared, and every declared part has an element. Read
 * from `custom-elements.json`, which the headless build generates from its
 * source, so drift on either side fails a build rather than a user.
 */
export function checkConformance(model: ComponentModel, manifest: Manifest): Diagnostic[] {
  const out: Diagnostic[] = []
  if (!model.tag || !model.contract) return out
  const tags = manifestTags(manifest)
  const root = tags.get(model.tag)
  const at = model.node.openTagLoc
  const report = (message: string) =>
    out.push(diagnostic(model.doc.source, CODES.CONFORMANCE, message, at))
  if (!root) {
    report(`"${model.name}" implements ${model.tag}, which the manifest does not declare`)
    return out
  }
  const props = new Set(model.contract.props.map((prop) => prop.name))
  for (const attribute of root.attributes ?? []) {
    if (!props.has(attribute.name)) {
      report(
        `${model.tag} exposes the attribute "${attribute.name}", which the contract does not declare as a prop`,
      )
    }
  }
  const events = new Set(model.contract.events.map((event) => event.name))
  for (const event of root.events ?? []) {
    if (!events.has(event.name)) {
      report(
        `${model.tag} dispatches "${event.name}", which the contract does not declare as an event`,
      )
    }
  }
  for (const event of model.contract.events) {
    if (!(root.events ?? []).some((entry) => entry.name === event.name)) {
      report(
        `the contract declares the event "${event.name}", which ${model.tag} does not dispatch`,
      )
    }
  }
  const tagSet = new Set(tags.keys())
  for (const part of model.contract.parts) {
    if (part === 'root') continue
    const tag = partTag(model.tag, part, tagSet)
    if (tagSet.has(tag)) continue
    // A shadow part is as declared as an element part. That the library
    // draws it, and the design's own drawing under it is for the canvas and
    // Figma, is how such a library works — not a finding.
    if ((root.cssParts ?? []).some((entry) => entry.name === part)) continue
    report(`part "${part}" has no element in the manifest (looked for ${tag})`)
  }
  return out
}
