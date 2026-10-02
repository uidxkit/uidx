// The headless behaviour: registering the custom elements is all a page needs.
import '@hwc/components/checkbox/index.js'
import '@hwc/components/field/index.js'
import '@hwc/components/button/index.js'
import '@hwc/components/radio-button/index.js'

import checkbox from '../generated/html/checkbox.html?raw'
import checkboxField from '../generated/html/checkbox-field.html?raw'
import button from '../generated/html/button.html?raw'
import contactList from '../generated/html/contact-list.html?raw'
import { mountReactDemo } from './react-demo'

/** The HTML target: the generated fragments, dropped into a page as-is. */
const sections: [string, string][] = [
  ['Checkbox', checkbox],
  ['CheckboxField', checkboxField],
  [
    'Button',
    `${button}\n${button.replace('<hwc-button>', '<hwc-button variant="secondary">')}\n${button.replace('<hwc-button>', '<hwc-button variant="outline" size="small">')}`,
  ],
  ['ContactList', contactList],
]
const html = document.getElementById('html-target')!
for (const [title, fragment] of sections) {
  const section = document.createElement('section')
  const heading = document.createElement('h2')
  heading.textContent = title
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = fragment
  section.append(heading, row)
  html.append(section)
}

mountReactDemo(document.getElementById('react-target')!)
