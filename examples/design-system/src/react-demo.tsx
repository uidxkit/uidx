import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, CheckboxField, ContactList, Field } from '../generated/react'
import type { Contact } from '../generated/react/models'

/**
 * The React target: the generated components, used the way an application
 * would. State lives in React; behaviour in the custom elements underneath.
 */
const people: Contact[] = [
  { id: 'ada', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'linus', name: 'Linus Torvalds', email: 'linus@example.com' },
]

function Demo() {
  const [checked, setChecked] = useState(false)
  const [chosen, setChosen] = useState<string | null>(null)
  return (
    <>
      <section>
        <h2>Checkbox</h2>
        <div className="row">
          <Checkbox checked={checked} onChange={({ checked: next }) => setChecked(next)} />
          <Checkbox indeterminate />
          <Checkbox checked disabled />
        </div>
      </section>
      <section>
        <h2>CheckboxField</h2>
        <CheckboxField
          label="Remember me"
          description="Stay signed in on this device for 30 days."
        />
        <Field
          label="Newsletter"
          description="One email a month."
          control={<Checkbox name="newsletter" />}
        />
      </section>
      <section>
        <h2>Button</h2>
        <div className="row">
          <Button label="Save" />
          <Button label="Cancel" variant="secondary" />
          <Button label="More" variant="outline" size="small" />
          <Button label="Delete" variant="destructive" />
          <Button label="Disabled" disabled />
        </div>
      </section>
      <section>
        <h2>ContactList</h2>
        <ContactList
          items={people}
          name="assignee"
          renderOption={(person) => (
            <ContactOptionRow
              person={person}
              chosen={chosen === person.id}
              onChoose={() => setChosen(person.id)}
            />
          )}
          empty={<span>No contacts yet</span>}
        />
        <p>Chosen: {chosen ?? 'nobody'}</p>
      </section>
    </>
  )
}

import { ContactOption } from '../generated/react'

function ContactOptionRow({
  person,
  chosen,
  onChoose,
}: {
  person: Contact
  chosen: boolean
  onChoose: () => void
}) {
  return (
    <ContactOption
      item={person}
      value={person.id}
      checked={chosen}
      onChange={({ checked }) => checked && onChoose()}
    />
  )
}

export function mountReactDemo(container: HTMLElement): void {
  createRoot(container).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  )
}
