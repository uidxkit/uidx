import { parse, type UidxDocument } from '@uidx/format'

const doc = (source: string): UidxDocument => {
  const result = parse(source)
  if (!result.doc) throw new Error(result.diagnostics.map((d) => d.message).join('; '))
  return result.doc
}

export function docsFixture(): Map<string, UidxDocument> {
  return new Map([
    [
      'components.uidx',
      doc(`---
id: components
---

## Core Intent

Shared surfaces.

## Visual Contract

<Page>
  <Component name="Card" status="stable" props={{ heading: { type: 'TEXT', default: 'Title' } }}>
    <Frame name="container" layoutMode="VERTICAL" width={280} height={180}>
      <Text name="title" characters="{heading}" fontSize={16} />
      <Slot name="body" layoutMode="VERTICAL" />
    </Frame>
  </Component>
</Page>
`),
    ],
    [
      'home.uidx',
      doc(`---
id: home
---

## Visual Contract

<Page>
  <Frame name="hero" width={600} height={200} cornerRadius="{radius#md}">
    <Text name="headline" characters="A friendly banner that says Welcome" fontSize={32} />
  </Frame>
  <Instance name="revenue" component="Card" x={0} y={0} props={{ heading: 'Revenue' }} />
</Page>
`),
    ],
    [
      'tokens.uidx',
      doc(`---
id: tokens
---

## Visual Contract

<Tokens>
  <Collection name="radius">
    <Variable name="md" type="FLOAT" value={8} />
  </Collection>
</Tokens>
`),
    ],
  ])
}
