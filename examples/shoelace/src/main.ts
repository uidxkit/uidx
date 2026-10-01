// Shoelace supplies the elements: registering them is all the behaviour there is.
import '@shoelace-style/shoelace/dist/components/button/button.js'
import '@shoelace-style/shoelace/dist/components/input/input.js'
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js'
import '@shoelace-style/shoelace/dist/components/switch/switch.js'

// The uidx identities supply the look: tokens (with the dark mode) and one
// stylesheet per component, exactly as generated.
import '../generated/html/tokens.css'
import '../generated/html/button.css'
import '../generated/html/input.css'
import '../generated/html/checkbox.css'
import '../generated/html/switch.css'

import button from '../generated/html/button.html?raw'
import input from '../generated/html/input.html?raw'
import checkbox from '../generated/html/checkbox.html?raw'
import switchHtml from '../generated/html/switch.html?raw'

import { log } from './log'
import { mountReact } from './react-demo'

/** A generated fragment as an element, optionally with extra attributes for a variant. */
function fragment(html: string, attributes: Record<string, string> = {}, text?: string): Element {
  const template = document.createElement('template')
  template.innerHTML = html
  const element = template.content.querySelector('*')!
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value)
  if (text !== undefined) element.querySelector('[data-node="text"]')!.textContent = text
  return element
}

function section(title: string, children: Element[], layout = 'row'): HTMLElement {
  const out = document.createElement('section')
  out.innerHTML = `<h2>${title}</h2>`
  const row = document.createElement('div')
  row.className = layout
  row.append(...children)
  out.append(row)
  return out
}

const target = document.getElementById('html-target')!
target.append(
  section('Button', [
    fragment(button),
    fragment(button, { variant: 'neutral' }, 'Cancel'),
    fragment(button, { variant: 'danger', size: 'small' }, 'Delete'),
    fragment(button, { size: 'large' }, 'Continue'),
    fragment(button, { disabled: '' }, 'Disabled'),
  ]),
  section(
    'Input',
    [fragment(input), fragment(input, { disabled: '', value: 'locked@example.com' })],
    'stack',
  ),
  section('Checkbox', [
    fragment(checkbox),
    fragment(checkbox, { checked: '' }, 'Already on'),
    fragment(checkbox, { disabled: '' }, 'Disabled'),
  ]),
  section('Switch', [
    fragment(switchHtml, {}, 'Notifications'),
    fragment(switchHtml, { checked: '' }, 'Sync'),
  ]),
)

// Every event the contracts declare, as the elements dispatch them.
for (const name of ['click', 'sl-change', 'sl-input']) {
  target.addEventListener(name, (event) => {
    const element = (event.target as Element).closest('sl-button, sl-input, sl-checkbox, sl-switch')
    if (!element || (name === 'click' && element.localName !== 'sl-button')) return
    const state = element as HTMLElement & { checked?: boolean; value?: string }
    const detail =
      'checked' in state && element.localName !== 'sl-button'
        ? ` checked=${state.checked}`
        : state.value !== undefined && element.localName === 'sl-input'
          ? ` value="${state.value}"`
          : ''
    log(`html  <${element.localName}> ${name}${detail}`)
  })
}

// The theme switch is the generated Switch itself, flipping the token mode.
const theme = fragment(switchHtml, {}, 'Dark mode') as HTMLElement & { checked: boolean }
theme.addEventListener('sl-change', () => {
  document.documentElement.dataset.color = theme.checked ? 'dark' : 'light'
  log(`theme data-color="${document.documentElement.dataset.color}"`)
})
document.getElementById('theme')!.append(theme)

mountReact(document.getElementById('react-target')!)
