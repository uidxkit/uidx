import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Button, Checkbox, Input, Switch } from '../generated/react'
import { log } from './log'

/**
 * The React target: the generated components, used the way an application
 * would. State lives in React; behaviour in Shoelace's elements underneath.
 */
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

export function mountReact(element: HTMLElement): void {
  createRoot(element).render(
    <StrictMode>
      <Demo />
    </StrictMode>,
  )
}
