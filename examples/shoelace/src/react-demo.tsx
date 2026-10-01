import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, Input, List, PersonCard, PersonChip, Switch } from '../generated/react'
import type { Person } from '../generated/react/models'
import { log } from './log'

/**
 * The React target: the generated components, used the way an application
 * would. State lives in React; behaviour in Shoelace's elements underneath.
 */
/** The list's data: what an application passes, typed by the generated model. */
const people: Person[] = [
  { id: 'ada', name: 'Ada Lovelace', role: 'Mathematician' },
  { id: 'grace', name: 'Grace Hopper', role: 'Rear admiral' },
  { id: 'katherine', name: 'Katherine Johnson', role: 'Orbital mechanics' },
]

/**
 * One List, four renderings: its own default row, and three items injected
 * through `renderItem` — two of the design system's components and a plain
 * one-off — without the List knowing about any of them.
 */
export function Lists() {
  return (
    <div className="lists">
      <List items={people} />
      <List
        items={people}
        renderItem={(person) => <PersonCard item={person} style={{ alignSelf: 'stretch' }} />}
      />
      <List items={people} renderItem={(person) => <PersonChip item={person} />} />
      <List
        items={people}
        renderItem={(person, index) => (
          <span className="custom-item">
            {index + 1}. {person.name} — {person.role}
          </span>
        )}
      />
    </div>
  )
}

function Demo() {
  const [count, setCount] = useState(0)
  const [agreed, setAgreed] = useState(false)
  return (
    <>
      <section>
        <h2>Button</h2>
        <div className="row">
          <Button
            label={`Clicked ${count}×`}
            onPress={() => {
              setCount((n) => n + 1)
              log('react <Button> onPress')
            }}
          />
          <Button label="Cancel" variant="neutral" />
          <Button label="Delete" variant="danger" size="small" disabled={!agreed} />
        </div>
      </section>
      <section>
        <h2>Input</h2>
        <Input
          label="Name"
          placeholder="Ada Lovelace"
          helpText="As it should appear on the invoice."
          onChange={() => log('react <Input> onChange')}
        />
      </section>
      <section>
        <h2>Checkbox · Switch</h2>
        <div className="row">
          <Checkbox
            label="I understand, enable Delete"
            onChange={() => {
              setAgreed((on) => !on)
              log('react <Checkbox> onChange')
            }}
          />
          <Switch label="Beta features" onChange={() => log('react <Switch> onChange')} />
        </div>
      </section>
    </>
  )
}

export function mountLists(element: HTMLElement): void {
  createRoot(element).render(
    <StrictMode>
      <Lists />
    </StrictMode>,
  )
}

export function mountReact(element: HTMLElement): void {
  createRoot(element).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  )
}
