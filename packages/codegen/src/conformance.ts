import { CODES, diagnostic, type Diagnostic } from '@uidx/format'
import {
  attributeName,
  eventName,
  manifestTags,
  partTag,
  type ComponentModel,
  type Manifest,
} from './model.js'

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
  // Compared in the library's spelling: a binding may rename an attribute
  // or an event, and the contract still has to cover what the element does.
  const props = new Set(model.contract.props.map((prop) => attributeName(model, prop.name)))
  for (const attribute of root.attributes ?? []) {
    if (!props.has(attribute.name)) {
      report(
        `${model.tag} exposes the attribute "${attribute.name}", which the contract does not declare as a prop`,
      )
    }
  }
  const events = new Set(model.contract.events.map((event) => eventName(model, event.name)))
  for (const event of root.events ?? []) {
    if (!events.has(event.name)) {
      report(
        `${model.tag} dispatches "${event.name}", which the contract does not declare as an event`,
      )
    }
  }
  for (const event of model.contract.events) {
    if (!(root.events ?? []).some((entry) => entry.name === eventName(model, event.name))) {
      report(
        `the contract declares the event "${event.name}", which ${model.tag} does not dispatch`,
      )
    }
  }
  const tagSet = new Set(tags.keys())
  // The tree's bindings are the parts this component uses (ADR 0013 §3).
  // Light-DOM parts marked by `data-part` are the consumer's markup; the
  // manifest has nothing to say about them.
  if (model.profile.parts === 'data-part') return out
  for (const { name, libraryName: part } of model.parts) {
    if (name === 'root') continue
    const tag = partTag(model.tag, part, tagSet)
    if (tagSet.has(tag)) continue
    // A shadow part is as declared as an element part. That the library
    // draws it, and the design's own drawing under it is for the canvas and
    // Figma, is how such a library works — not a finding.
    if ((root.cssParts ?? []).some((entry) => entry.name === part)) continue
    report(
      `part "${name}"${part === name ? '' : ` (bound to "${part}")`} has no element in the manifest (looked for ${tag})`,
    )
  }
  return out
}
