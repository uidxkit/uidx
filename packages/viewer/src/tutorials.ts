import { aliasTarget, type UidxDocument, type UidxNode } from '@uidx/format'
import { repeatOf, type ModelIndex } from '@uidx/schema'
import { itemCount } from './model-edits'

/**
 * Guided tutorials: short tours that point at the real control to use next
 * and move on when the document shows the step was done — whichever way the
 * designer did it (a shortcut, a menu, a drag). Pure data and predicates
 * here; `TourCoach.vue` draws them and `tour.ts` holds where a run is.
 */

/** What a step can read about the editor. */
export interface TourState {
  view: 'home' | 'page' | 'docs' | 'tokens' | 'fonts' | 'models'
  /** The page the canvas holds. */
  file: string | null
  pages: ReadonlyMap<string, UidxDocument>
  selection: readonly string[]
  components: ReadonlyMap<string, UidxNode>
  models: ModelIndex | undefined
  /** For what only the screen knows: an open dialog, the panel's tab. */
  query: (selector: string) => Element | null
}

/** What existed when the run started, so a step can tell what the designer made. */
export interface TourMemory {
  components: ReadonlySet<string>
  models: ReadonlySet<string>
  pages: ReadonlySet<string>
}

export interface TutorialStep {
  id: string
  title: string
  /** Plain words; `code` and **bold** are rendered. */
  body: string
  /** The control to point at, as a selector; none for a step about the canvas or the whole screen. */
  target?: string | ((state: TourState, memory: TourMemory) => string | null)
  /** True once the step is done; a step without one is read and moved on with Next. */
  done?: (state: TourState, memory: TourMemory) => boolean
}

export interface Tutorial {
  id: string
  title: string
  summary: string
  minutes: number
  steps: TutorialStep[]
}

/* ------------------------------------------------------------- helpers */

/** The component the designer made during this run, newest name first. */
export function madeComponent(state: TourState, memory: TourMemory): UidxNode | null {
  for (const [name, node] of state.components) if (!memory.components.has(name)) return node
  return null
}

export function madeModel(state: TourState, memory: TourMemory) {
  for (const [name, model] of state.models ?? []) if (!memory.models.has(name)) return model
  return null
}

/** The page a component is declared on. */
export function fileOf(state: TourState, name: string): string | null {
  for (const [file, doc] of state.pages)
    if (doc.tree.children.some((child) => child.element === 'Component' && child.name === name))
      return file
  return null
}

const walk = (node: UidxNode, visit: (node: UidxNode) => void): void => {
  visit(node)
  for (const child of node.children) walk(child, visit)
}
const find = (node: UidxNode | null, test: (node: UidxNode) => boolean): UidxNode | null => {
  let found: UidxNode | null = null
  if (node)
    walk(node, (candidate) => {
      if (!found && candidate !== node && test(candidate)) found = candidate
    })
  return found
}

const attr = (node: UidxNode | null | undefined, name: string) => node?.attrs[name]?.value

/** The style row for a state of the made component: `hover`, or `checked=true`. */
function styleRow(state: TourState, memory: TourMemory, key: string, value: string) {
  const component = madeComponent(state, memory)
  const file = component ? fileOf(state, component.name) : null
  const doc = file ? state.pages.get(file) : undefined
  return doc?.spec?.styles?.find((row) => row.keys[key] === value) ?? null
}

const onOverview = (state: TourState): boolean => state.view === 'home'
const dialogOpen = (state: TourState): boolean =>
  state.query('dialog[open] #new-page-title') !== null

/** The made component exists and its page is open on the canvas. */
const madeAndOpen = (state: TourState, memory: TourMemory): boolean => {
  const component = madeComponent(state, memory)
  return component !== null && state.view === 'page' && state.file === fileOf(state, component.name)
}

const layerRow = (address: string): string =>
  `[role="treeitem"][data-address="${address.replace(/"/g, '\\"')}"]`

/* ------------------------------------------------------- shared steps */

const toOverview = (id: string, body: string): TutorialStep => ({
  id,
  title: 'Go to the Overview',
  body,
  target: '[data-tour="overview"], [data-face="home"]',
  done: onOverview,
})

const newPage: TutorialStep = {
  id: 'new-page',
  title: 'Click New page',
  body: 'Every component lives on a page of its own.',
  target: '[data-tour="new-page"]',
  done: (state, memory) => dialogOpen(state) || madeComponent(state, memory) !== null,
}

const createComponent = (name: string, why: string): TutorialStep => ({
  id: 'create',
  title: `Create a component called ${name}`,
  body: `Choose **Component**, type \`${name}\`, then click **Create component**. ${why}`,
  target: 'dialog[open]',
  done: madeAndOpen,
})

const selectMade = (body: string): TutorialStep => ({
  id: 'select',
  title: 'Select it',
  body,
  target: (state, memory) => {
    const component = madeComponent(state, memory)
    return component ? layerRow(component.address) : null
  },
  done: (state, memory) => {
    const component = madeComponent(state, memory)
    return component !== null && state.selection[0] === component.address
  },
})

/* ----------------------------------------------------------- tutorials */

const STARTER_FILL = JSON.stringify([
  { type: 'SOLID', color: { r: 0.933, g: 0.941, b: 0.957, a: 1 } },
])

const button: Tutorial = {
  id: 'button',
  title: 'Create a button',
  summary: 'Make a component, style it, add a hover state, and use it on a page.',
  minutes: 4,
  steps: [
    {
      id: 'intro',
      title: 'Build a Button',
      body: "You'll make a Button, give it a hover state, then use it on a page. The tour moves on by itself as you do each step.",
    },
    toOverview('overview', 'Your pages and components start here.'),
    newPage,
    createComponent('Button', 'It starts as a ready-made button you can change.'),
    selectMade('Click **Button** in the layers list on the left, or click it on the canvas.'),
    {
      id: 'fill',
      title: 'Pick its color',
      body: 'In **Fill** on the right, click the color swatch or the token button and choose a color.',
      target: '[aria-label="Fill"]',
      done: (state, memory) => {
        // "Not the starter" only counts on a Button that is there: before a
        // reload's pages arrive there is none, and that is not a colour picked.
        const component = madeComponent(state, memory)
        return component !== null && JSON.stringify(attr(component, 'fills')) !== STARTER_FILL
      },
    },
    {
      id: 'radius',
      title: 'Round the corners',
      body: 'In **Appearance**, change **Corner radius** — try 999 for a pill.',
      target: '[aria-label="Appearance"]',
      done: (state, memory) => {
        const component = madeComponent(state, memory)
        return component !== null && attr(component, 'cornerRadius') !== 6
      },
    },
    {
      id: 'contract',
      title: 'Open the Contract tab',
      body: 'The contract says what each use of the Button can change. It already has `label` — the words it shows.',
      target: '[data-tour="tab-contract"]',
      done: (state) => state.query('[data-tour="tab-contract"][aria-pressed="true"]') !== null,
    },
    {
      id: 'hover',
      title: 'Add a hover state',
      body: 'Under **States**, tick **Hover**. A hover copy appears beside your Button.',
      target: '[data-tour="states"]',
      done: (state, memory) => styleRow(state, memory, 'state', 'hover') !== null,
    },
    {
      id: 'hover-style',
      title: 'Style the hover',
      body: 'Click the **hover** copy on the canvas, open **Design**, and change its **Fill**.',
      // The canvas first; once the hover copy is selected, its Fill.
      target: (state) =>
        state.selection.some((address) => address.includes('#state=hover'))
          ? '[aria-label="Fill"]'
          : null,
      done: (state, memory) => {
        const row = styleRow(state, memory, 'state', 'hover')
        return row !== null && Object.keys(row.values).length > 0
      },
    },
    toOverview('overview-2', 'Now use your Button somewhere.'),
    {
      id: 'screen',
      title: 'Make a page to use it on',
      body: 'Click **New page**, keep **Page**, name it `Screen`, and click **Create page**.',
      target: (state) => (dialogOpen(state) ? 'dialog[open]' : '[data-tour="new-page"]'),
      done: (state, memory) => {
        // The page itself, arrived: a page not here yet declares no component
        // either, and is not a page made to use the Button on.
        const doc = state.file ? state.pages.get(state.file) : undefined
        return (
          state.view === 'page' &&
          doc !== undefined &&
          !memory.pages.has(state.file!) &&
          !doc.tree.children.some((c) => c.element === 'Component')
        )
      },
    },
    {
      id: 'place',
      title: 'Place your Button',
      body: 'Click **Insert** in the toolbar, choose **Button**, then click on the canvas.',
      target: 'button[aria-label="Insert"]',
      done: (state, memory) => placedInstance(state, memory) !== null,
    },
    {
      id: 'words',
      title: 'Change its words',
      body: 'With the Button selected, type new words in **label** under **Properties**.',
      target: '[data-prop="label"]',
      done: (state, memory) => {
        const props = attr(placedInstance(state, memory), 'props')
        return !!props && typeof props === 'object' && 'label' in props
      },
    },
    {
      id: 'finish',
      title: 'Your Button is ready',
      body: 'Change the Button once and every use follows. **Get code** turns it into HTML and React.',
      target: '[data-action="code"]',
    },
  ],
}

/** An instance of the made component on the open page. */
function placedInstance(state: TourState, memory: TourMemory): UidxNode | null {
  const component = madeComponent(state, memory)
  const doc = state.file ? state.pages.get(state.file) : undefined
  if (!component || !doc) return null
  return find(
    doc.tree,
    (node) => node.element === 'Instance' && attr(node, 'component') === component.name,
  )
}

const knob = (state: TourState, memory: TourMemory): UidxNode | null =>
  find(madeComponent(state, memory), (node) => node.element === 'Ellipse')

const switchTutorial: Tutorial = {
  id: 'switch',
  title: 'Create a switch',
  summary: 'Draw a track and a knob, add a checked state, and style it on.',
  minutes: 4,
  steps: [
    {
      id: 'intro',
      title: 'Build a Switch',
      body: "You'll shape a track, add a knob, and give it an on state. The tour moves on as you go.",
    },
    toOverview('overview', 'Start from the Overview.'),
    newPage,
    createComponent('Switch', 'It starts with a label — a switch does not need one.'),
    {
      id: 'remove-label',
      title: 'Remove the label',
      body: 'Click **label** in the layers list and press **Delete**.',
      target: (state, memory) => {
        const label = find(madeComponent(state, memory), (node) => node.element === 'Text')
        return label ? layerRow(label.address) : null
      },
      done: (state, memory) => {
        const component = madeComponent(state, memory)
        return component !== null && !find(component, (node) => node.element === 'Text')
      },
    },
    selectMade('Click **Switch** in the layers list to select the track.'),
    {
      id: 'track',
      title: 'Shape the track',
      body: 'In **Layout**, set **Width** 44 and **Height** 24. In **Appearance**, set **Corner radius** 12.',
      target: '[aria-label="Layout"]',
      done: (state, memory) => {
        const component = madeComponent(state, memory)
        const radius = attr(component, 'cornerRadius')
        return attr(component, 'width') !== undefined && typeof radius === 'number' && radius >= 8
      },
    },
    {
      id: 'padding',
      title: 'Tighten the padding',
      body: 'In **Auto layout › Padding**, set both values to 3 so the knob fits snugly. Tip: click an empty spot of the canvas, select the Switch in the layers list, and press **Shift+2** to zoom to it.',
      target: '[aria-label="Layout"]',
      done: (state, memory) => {
        const top = attr(madeComponent(state, memory), 'paddingTop')
        const left = attr(madeComponent(state, memory), 'paddingLeft')
        return typeof top === 'number' && top <= 4 && typeof left === 'number' && left <= 4
      },
    },
    {
      id: 'start',
      title: 'Start the knob on the left',
      body: 'In **Auto layout › Alignment**, click the **left-middle** dot.',
      target: '[aria-label="alignment"]',
      done: (state, memory) =>
        attr(madeComponent(state, memory), 'primaryAxisAlignItems') === 'MIN',
    },
    {
      id: 'knob',
      title: 'Add the knob',
      body: 'Pick the **Ellipse** tool (O) and click inside the Switch. Zoom in first (**Shift+2**) if it is small on screen.',
      target: 'button[aria-label="Ellipse"]',
      done: (state, memory) => knob(state, memory) !== null,
    },
    {
      id: 'knob-size',
      title: 'Size the knob',
      body: 'With the ellipse selected, set **Width** and **Height** to 18, and pick a light **Fill**.',
      target: '[aria-label="Layout"]',
      done: (state, memory) => {
        const width = attr(knob(state, memory), 'width')
        return typeof width === 'number' && width <= 24
      },
    },
    {
      id: 'checked',
      title: 'Add a checked property',
      body: 'Select **Switch**, open **Contract**. In the add row choose **boolean**, name it `checked`, and click **+**.',
      target: (state) =>
        state.query('[data-field="add-declaration"]')
          ? '[data-field="add-declaration"]'
          : '[data-tour="tab-contract"]',
      done: (state, memory) =>
        !!madeComponent(state, memory)?.spec?.contract?.props.some(
          (prop) => prop.type === 'boolean',
        ),
    },
    {
      id: 'visual',
      title: 'Make checked a state',
      body: 'Under **checked** in Properties, tick **Visual** (click **checked** to open it if it is closed). Off and on then sit side by side.',
      target: 'input[aria-label="Visual"]',
      done: (state, memory) =>
        !!madeComponent(state, memory)?.spec?.contract?.props.some(
          (prop) => prop.type === 'boolean' && prop.visual,
        ),
    },
    {
      id: 'on-style',
      title: 'Style the on state',
      target: (state) =>
        state.selection.some((address) => /#state=|=true/.test(address))
          ? '[aria-label="alignment"]'
          : null,
      body: 'Click the **checked** copy on the canvas (the one on the right). In **Design**, pick the **right-middle** alignment dot and an accent **Fill**.',
      done: (state, memory) => {
        const component = madeComponent(state, memory)
        const prop = component?.spec?.contract?.props.find((p) => p.type === 'boolean' && p.visual)
        // A visual flag's row is written as a state, `state="checked"`, or by value.
        const row = prop
          ? (styleRow(state, memory, 'state', prop.name) ??
            styleRow(state, memory, prop.name, 'true'))
          : null
        return row !== null && Object.keys(row.values).length > 0
      },
    },
    {
      id: 'finish',
      title: 'Your Switch is ready',
      body: 'One component, two looks. Uses set `checked`, and **Get code** wires it into HTML and React.',
      target: '[data-action="code"]',
    },
  ],
}

const textRepeat = (state: TourState, memory: TourMemory): UidxNode | null =>
  find(madeComponent(state, memory), (node) => node.element === 'Text')

const list: Tutorial = {
  id: 'list',
  title: 'Create a list',
  summary: 'Make a model with items, then repeat a layer for each one.',
  minutes: 4,
  steps: [
    {
      id: 'intro',
      title: 'Build a list',
      body: "You'll make a list component, describe people as a model, add a few, and draw one row per person. The tour moves on as you go.",
    },
    toOverview('overview', 'Start from the Overview.'),
    newPage,
    createComponent('People', 'Its label will become one row per person.'),
    {
      id: 'models',
      title: 'Open Models',
      body: 'Models describe your content: the fields one item has, and the items themselves.',
      target: '[data-face="models"]',
      done: (state) => state.view === 'models',
    },
    {
      id: 'model',
      title: 'Create a Person model',
      body: 'Type `Person` in the name box and click **+ New model**.',
      target: '.new-model',
      done: (state, memory) => madeModel(state, memory) !== null,
    },
    {
      id: 'field',
      title: 'Give it a name field',
      body: 'Click **+ Add field**, then rename `field` to `name`.',
      target: (state, memory) => {
        const model = madeModel(state, memory)
        return model ? `[data-model="${model.name}"]` : null
      },
      done: (state, memory) =>
        !!madeModel(state, memory)?.fields.some((field) => field.name !== 'field'),
    },
    {
      id: 'items',
      title: 'Add some people',
      body: 'Open **Items**, click **+ Add item** three times, and type a name in each row.',
      target: (state, memory) => {
        const model = madeModel(state, memory)
        return model ? `[data-model="${model.name}"]` : null
      },
      done: (state, memory) => {
        const model = madeModel(state, memory)
        const field = model?.fields.find((candidate) => candidate.name !== 'field')
        if (!model || !field || itemCount(model) < 3) return false
        const names = Array.isArray(field.sample) ? field.sample : []
        return names.filter((name) => typeof name === 'string' && name.trim()).length >= 3
      },
    },
    {
      id: 'design',
      title: 'Back to your component',
      body: 'Click **Design** at the top to return to People.',
      target: '[data-face="page"]',
      done: madeAndOpen,
    },
    selectMade('Click **People** in the layers list.'),
    {
      id: 'column',
      title: 'Stack it',
      body: 'In **Auto layout › Direction**, choose **Column**.',
      target: '[aria-label="Layout"]',
      done: (state, memory) => attr(madeComponent(state, memory), 'layoutMode') === 'VERTICAL',
    },
    {
      id: 'repeat',
      title: 'Repeat the label for each person',
      body: 'Select **label** in the layers list. Switch on **Repeat** and pick **Person**.',
      target: (state, memory) => {
        const text = textRepeat(state, memory)
        if (text && state.selection[0] === text.address) return '[data-field="repeat"]'
        return text ? layerRow(text.address) : null
      },
      done: (state, memory) => {
        const text = textRepeat(state, memory)
        return text !== null && repeatOf(text) !== null
      },
    },
    {
      id: 'bind',
      title: "Show each person's name",
      body: 'In **Text** on the right, click the bound **label** chip and pick **This Person › name** under **From each row**.',
      target:
        '.section[aria-label="Text"] .property-pill, .section[aria-label="Text"] .apply-property',
      done: (state, memory) => {
        const text = textRepeat(state, memory)
        const repeat = text ? repeatOf(text) : null
        const target = aliasTarget(attr(text, 'characters') ?? null)
        return !!repeat && !!target && target.startsWith(`${repeat.as}.`)
      },
    },
    {
      id: 'finish',
      title: 'Your list is ready',
      body: 'One row per person. Add or edit people in **Models** and the list follows.',
      target: '[data-face="models"]',
    },
  ],
}

export const TUTORIALS: readonly Tutorial[] = [button, switchTutorial, list]

/**
 * No pages are here, though the run began with some or is past Create, which
 * made one: a reload, before the document has arrived. The editor opens on
 * the Overview until then, so a step judged now — "Go to the Overview", say —
 * would pass for nothing the designer did.
 */
export function awaitingDocument(
  state: TourState,
  run: { tutorial: Tutorial; index: number; memory: TourMemory },
): boolean {
  if (state.pages.size > 0) return false
  const create = run.tutorial.steps.findIndex((step) => step.id === 'create')
  return run.memory.pages.size > 0 || (create >= 0 && run.index > create)
}

/** What exists now — taken when a run starts. */
export function snapshot(state: TourState): TourMemory {
  return {
    components: new Set(state.components.keys()),
    models: new Set(state.models?.keys() ?? []),
    pages: new Set(state.pages.keys()),
  }
}
