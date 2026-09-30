import { contractType, type HeadlessElement, type HeadlessMember } from './headless.js'

/**
 * A draft identity for an element a headless library already ships (`uidx
 * adopt`): the design system starts from the code that exists instead of a
 * blank page. The contract is the element's attributes, events, slots and
 * parts, with the manifest's words where it has them and `Describe …`
 * placeholders the Contract tab marks where it does not; the anatomy is a
 * plain frame with one layer per part and one `<Slot>` per named slot, ready
 * to be drawn over. Status is `draft` until somebody designs it.
 *
 * Pure: an element in, `.uidx` source out.
 */
export interface AdoptedPage {
  /** Suggested file name, `checkbox.uidx`. */
  file: string
  /** The component's name, `Checkbox`. */
  name: string
  source: string
}

const PLACEHOLDER = 'Describe '

/** `hwc-text-input` → `TextInput`: the library prefix is its spelling, not the design system's. */
export function componentNameFor(tag: string): string {
  const words = tag.split('-')
  const kept = words.length > 1 ? words.slice(1) : words
  return kept.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
}

export function adoptElement(
  element: HeadlessElement,
  name = componentNameFor(element.tag),
): AdoptedPage {
  const stem = element.tag.split('-').slice(1).join('-') || element.tag
  const words = (member: HeadlessMember, what: string): string =>
    escape(member.description ?? `${PLACEHOLDER}the ${what} "${member.name}".`)

  const anatomy: string[] = []
  for (const part of element.parts) {
    anatomy.push(
      `    <Frame name="${part.name}" part="${part.name}" width={16} height={16} cornerRadius={4} />`,
    )
  }
  const namedSlots = element.members.slots.filter((slot) => slot.name !== '')
  const defaultSlot = element.members.slots.some((slot) => slot.name === '')
  for (const slot of namedSlots) anatomy.push(`    <Slot name="${slot.name}" />`)
  if (defaultSlot) {
    anatomy.push(
      `    <Slot name="default">`,
      `      <Text name="content" characters="${name}" fontSize={14} />`,
      `    </Slot>`,
    )
  }

  const props = element.members.attributes
    .filter((attribute) => attribute.name)
    .map((attribute) => {
      const type = contractType(attribute.type)
      const flags = type === 'boolean' ? ' default={false} visual' : ''
      return `  <Prop name="${attribute.name}" type="${type}"${flags}>${words(attribute, 'prop')}</Prop>`
    })
  const events = element.members.events
    .filter((event) => event.name)
    .map((event) => `  <Event name="${event.name}">${words(event, 'event')}</Event>`)
  const slots = [
    ...namedSlots.map((slot) => `  <Slot name="${slot.name}">${words(slot, 'slot')}</Slot>`),
    ...(defaultSlot
      ? [
          `  <Slot name="default">${words(
            element.members.slots.find((slot) => slot.name === '') ?? { name: 'default' },
            'slot',
          )}</Slot>`,
        ]
      : []),
  ]
  const parts = element.parts.map(
    (part) => `  <Part name="${part.name}">${PLACEHOLDER}the part "${part.name}".</Part>`,
  )

  const contract: string[] = []
  if (props.length) contract.push('<Props>', ...props, '</Props>')
  if (events.length) contract.push('<Events>', ...events, '</Events>')
  if (slots.length) contract.push('<Slots>', ...slots, '</Slots>')
  if (parts.length) contract.push('<Parts>', ...parts, '</Parts>')

  const source = [
    '---',
    `id: ${stem}`,
    '---',
    '',
    escape(element.description ?? `${PLACEHOLDER}what ${name} is for.`),
    '',
    '## Visual Contract',
    '',
    '<Page>',
    `  <Component name="${name}" status="draft" implements="${element.tag}"`,
    `    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"`,
    `    counterAxisAlignItems="CENTER" itemSpacing={8} paddingLeft={12} paddingRight={12}`,
    `    paddingTop={8} paddingBottom={8}${anatomy.length ? '>' : ' />'}`,
    ...(anatomy.length ? [...anatomy, '  </Component>'] : []),
    '</Page>',
    ...(contract.length ? ['', '## Contract', '', ...contract] : []),
    '',
  ].join('\n')
  return { file: `${stem}.uidx`, name, source }
}

/** Words inside an element's text or the intent: nothing that reads as markup. */
function escape(text: string): string {
  return text.replace(/[<>{}]/g, (char) => ({ '<': '‹', '>': '›', '{': '(', '}': ')' })[char]!)
}
