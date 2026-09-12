/** Deterministic stress fixture, independent of authored showcase designs. */
export function largeDocument(): string {
  const stations = ['full', 'transit', 'approach']
  const lands = ['dots', 'filled', 'mesh', 'bare']
  const tiles = Array.from(
    { length: 300 },
    (_, i) => `
    <Frame name="tile-${i}" width={160} height={120} x={${(i % 20) * 180}} y={${Math.floor(i / 20) * 140}}>
      <Rectangle name="background" width={160} height={120} cornerRadius={8} fills={[{ type: 'SOLID', color: '#284560' }]} />
      <Text name="label" characters="Station ${i}: layout, geometry and typography" width={140} height={32} fontSize={14} />
    </Frame>`,
  ).join('')
  return `---
id: large-document
---

## Visual Contract

<Page>
  <Frame name="doc"><Frame name="cover" width={1600} height={900} /></Frame>
  <Component name="Atlas" variants={{ station: ${JSON.stringify(stations)}, land: ${JSON.stringify(lands)} }}>
    ${stations
      .flatMap((station) =>
        lands.map(
          (land) => `
      <Variant station="${station}" land="${land}">
        <Frame name="atlas" width={4000} height={3000}>${tiles}</Frame>
      </Variant>`,
        ),
      )
      .join('')}
  </Component>
</Page>
`
}
