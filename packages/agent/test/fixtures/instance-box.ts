import { parse, type UidxDocument } from '@uidx/format'

/**
 * The component shapes ADR 0018 tells apart, for the agent's instance-box
 * tests. Each puts a use's outer box on a different node.
 *
 * Button1 is a test copy of the pill button placed on examples/design-system's
 * page1: a hugging row with padding, a solid fill, one bound label and one
 * hover row. Its styles table derives a variant set, so its box is the
 * derived `root` one level down.
 */
export const BUTTON1 = `---
id: button1
---

A pill button: a hugging row with padding, a solid fill and one label.

## Visual Contract

<Page>
  <Component name="Button1" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    paddingLeft={12} paddingRight={12} paddingTop={8} paddingBottom={8} cornerRadius={999}
    fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0, g: 0.3333, b: 1, a: 1 } }]}>
    <Text name="label" characters="{label}" fontSize={14} />
  </Component>
</Page>

<Styles>
  <Style state="hover" root:fills={[{ opacity: 1, visible: true, type: 'SOLID', color: { r: 0.3678, g: 0.5744, b: 0.9875, a: 1 } }]} />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Button1">The words it shows.</Prop>
</Props>
`

/**
 * The other shapes, none with a styles table: Chip lays itself out, so its
 * box is the instance's own node; Tag only wraps one laid-out frame; Badge's
 * authored variants each wrap one frame; TagField composes one Tag; Caption
 * is a bare text, which the build draws as a hugging column; and Dot is a
 * fixed box that places its mark itself, so it lays nothing out.
 */
export const KINDS = `---
id: kinds
---

Component shapes for the instance-box tests.

## Visual Contract

<Page>
  <Component name="Chip" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    itemSpacing={4} paddingLeft={8} paddingRight={8} cornerRadius={6}>
    <Text name="label" characters="Chip" fontSize={12} />
  </Component>
  <Component name="Tag" status="draft">
    <Frame name="box" layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
      paddingLeft={6} paddingRight={6} cornerRadius={4}>
      <Text name="label" characters="Tag" fontSize={12} />
    </Frame>
  </Component>
  <Component name="Badge" status="draft" variants={{ tone: ['info', 'warn'] }}>
    <Variant tone="info">
      <Frame name="badge" layoutMode="HORIZONTAL" paddingLeft={8} paddingRight={8}>
        <Text name="label" characters="Info" fontSize={12} />
      </Frame>
    </Variant>
    <Variant tone="warn">
      <Frame name="badge" layoutMode="HORIZONTAL" paddingLeft={8} paddingRight={8}>
        <Text name="label" characters="Warn" fontSize={12} />
      </Frame>
    </Variant>
  </Component>
  <Component name="TagField" status="draft">
    <Instance name="tag" component="Tag" />
  </Component>
  <Component name="Caption" status="draft">
    <Text name="words" characters="Caption" fontSize={12} />
  </Component>
  <Component name="Dot" status="draft" width={8} height={8} cornerRadius={4}>
    <Rectangle name="mark" x={2} y={2} width={4} height={4} />
  </Component>
</Page>
`

function doc(source: string): UidxDocument {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

/** Both files parsed, keyed as a workspace keys them. */
export function instanceBoxDocs(): Map<string, UidxDocument> {
  return new Map([
    ['button1.uidx', doc(BUTTON1)],
    ['kinds.uidx', doc(KINDS)],
  ])
}
