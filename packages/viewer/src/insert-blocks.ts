import type { UidxNodeSpec } from '@uidx/format'

/**
 * The Insert panel's ready-made blocks: small, well-formed starting points a
 * designer drops in and restyles, the way Builder's and Webflow's insert
 * panels offer a Box, Columns or a Button before any component exists.
 * Plain frames and text with auto layout — nothing here is a component until
 * the author makes it one.
 */
export interface Block {
  id: string
  label: string
  hint: string
  /** A 16-unit icon path. */
  icon: string
  node: () => UidxNodeSpec
}

const solid = (r: number, g: number, b: number) => [{ type: 'SOLID', color: { r, g, b, a: 1 } }]
const text = (name: string, characters: string, size = 14, weight?: string): UidxNodeSpec => ({
  element: 'Text',
  attrs: { name, characters, fontSize: size, ...(weight ? { fontWeight: weight } : {}) },
})
/** Text that fills its auto-layout parent's width and wraps, growing in height. */
const wrapping = (spec: UidxNodeSpec): UidxNodeSpec => ({
  ...spec,
  attrs: { ...spec.attrs, layoutAlign: 'STRETCH', textAutoResize: 'HEIGHT' },
})

export const BLOCKS: readonly Block[] = [
  {
    id: 'stack',
    label: 'Stack',
    hint: 'A vertical auto-layout frame',
    icon: 'M3 2.5h10v4H3zM3 9.5h10v4H3z',
    node: () => ({
      element: 'Frame',
      attrs: {
        name: 'stack',
        layoutMode: 'VERTICAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        itemSpacing: 12,
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
      },
      children: [text('first', 'First item'), text('second', 'Second item')],
    }),
  },
  {
    id: 'row',
    label: 'Row',
    hint: 'A horizontal auto-layout frame',
    icon: 'M2.5 3h4v10h-4zM9.5 3h4v10h-4z',
    node: () => ({
      element: 'Frame',
      attrs: {
        name: 'row',
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        counterAxisAlignItems: 'CENTER',
        itemSpacing: 12,
      },
      children: [text('start', 'Start'), text('end', 'End')],
    }),
  },
  {
    id: 'card',
    label: 'Card',
    hint: 'A padded surface with a title and body',
    icon: 'M2.5 3h11v10h-11zM5 6h6M5 8.5h4',
    node: () => ({
      element: 'Frame',
      attrs: {
        name: 'card',
        layoutMode: 'VERTICAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'FIXED',
        width: 280,
        itemSpacing: 8,
        paddingLeft: 20,
        paddingRight: 20,
        paddingTop: 20,
        paddingBottom: 20,
        cornerRadius: 12,
        fills: solid(1, 1, 1),
        strokes: solid(0.886, 0.898, 0.918),
        strokeWeight: 1,
      },
      children: [
        wrapping(text('title', 'Card title', 16, 'SEMI_BOLD')),
        wrapping(text('body', 'A short description of what this card is about.', 14)),
      ],
    }),
  },
  {
    id: 'button',
    label: 'Button',
    hint: 'A label in a filled, rounded frame',
    icon: 'M2 5h12v6H2zM5.5 8h5',
    node: () => ({
      element: 'Frame',
      attrs: {
        name: 'button',
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'AUTO',
        counterAxisSizingMode: 'AUTO',
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
        paddingLeft: 16,
        paddingRight: 16,
        paddingTop: 10,
        paddingBottom: 10,
        cornerRadius: 8,
        fills: solid(0.145, 0.388, 0.922),
      },
      children: [
        {
          element: 'Text',
          attrs: {
            name: 'label',
            characters: 'Button',
            fontSize: 14,
            fontWeight: 'MEDIUM',
            fills: solid(1, 1, 1),
          },
        },
      ],
    }),
  },
  {
    id: 'input',
    label: 'Input',
    hint: 'A field frame with placeholder text',
    icon: 'M2 5h12v6H2zM4.5 6.5v3',
    node: () => ({
      element: 'Frame',
      attrs: {
        name: 'input',
        layoutMode: 'HORIZONTAL',
        primaryAxisSizingMode: 'FIXED',
        counterAxisSizingMode: 'AUTO',
        counterAxisAlignItems: 'CENTER',
        width: 240,
        paddingLeft: 12,
        paddingRight: 12,
        paddingTop: 10,
        paddingBottom: 10,
        cornerRadius: 8,
        fills: solid(1, 1, 1),
        strokes: solid(0.788, 0.808, 0.847),
        strokeWeight: 1,
      },
      children: [
        {
          element: 'Text',
          attrs: {
            name: 'placeholder',
            characters: 'Placeholder',
            fontSize: 14,
            fills: solid(0.42, 0.447, 0.502),
          },
        },
      ],
    }),
  },
  {
    id: 'heading',
    label: 'Heading',
    hint: 'Large, bold text',
    icon: 'M3.5 3v10M12.5 3v10M3.5 8h9',
    node: () => text('heading', 'Heading', 28, 'BOLD'),
  },
]
