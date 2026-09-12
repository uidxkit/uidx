import { describe, expect, it } from 'vitest'
import {
  IDENTITY_PROPS,
  PIN_PROPS,
  PROP_TABLE,
  PROP_UI,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  SECTION_ORDER,
  fieldOrderFor,
  optionLabelFor,
  propUiFor,
  sectionOrderFor,
} from '../src/index.js'

/**
 * `prop-ui.ts` is the second home of the vocabulary the spec asks for
 * (docs/properties-panel.md, "The core problem"). These are its two drift
 * tests: every key here names a real prop, and every real prop is covered
 * here or opted out explicitly.
 */
describe('PROP_UI', () => {
  // The pin offsets are known to the vocabulary and absent from the table on
  // purpose (ADR 0011 §2) — a prop with no scene field cannot be echoed back
  // into the file by a reflow. The panel is the one place they are a control,
  // so this set is "props the schema knows", not "props it maps".
  const KNOWN = new Set([...IDENTITY_PROPS, ...PROP_TABLE.map((m) => m.uidx), ...PIN_PROPS])

  it('every key names a prop the schema actually knows', () => {
    for (const key of Object.keys(PROP_UI)) {
      expect(KNOWN.has(key), `PROP_UI has an entry for unknown prop "${key}"`).toBe(true)
    }
  })

  it('every known prop has an entry or an explicit opt-out', () => {
    for (const prop of KNOWN) {
      const covered = prop in PROP_UI || PROP_UI_OPT_OUT.has(prop)
      expect(covered, `"${prop}" has neither a PROP_UI entry nor an opt-out`).toBe(true)
    }
  })

  it('opted-out props are not also entries', () => {
    for (const prop of PROP_UI_OPT_OUT) {
      expect(PROP_UI[prop], `"${prop}" is both an entry and an opt-out`).toBeUndefined()
    }
  })

  it('name is the only opt-out — renaming is a structural op (Epic D), not a property edit', () => {
    expect([...PROP_UI_OPT_OUT]).toEqual(['name'])
  })

  it('every entry belongs to a group SECTION_ORDER knows, with a label', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      expect(SECTION_ORDER, `"${prop}"'s group is not in SECTION_ORDER`).toContain(ui.group)
      expect(SECTION_LABEL[ui.group], `no label for group "${ui.group}"`).toBeTruthy()
    }
  })

  it('pairs point at a sibling that points back', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (!ui.pairs) continue
      const partner = PROP_UI[ui.pairs]
      expect(partner, `"${prop}" pairs with unknown prop "${ui.pairs}"`).toBeDefined()
      expect(partner?.pairs, `"${prop}"/"${ui.pairs}" pairing is not mutual`).toBe(prop)
    }
  })

  it('layoutMode offers exactly the engine four, and nothing lets you type a fifth', () => {
    expect(propUiFor('layoutMode')).toMatchObject({
      control: 'enum',
      options: ['NONE', 'HORIZONTAL', 'VERTICAL', 'GRID'],
    })
  })

  it('sizing modes do not offer FILL — the format cannot write it yet (ADR 0002, A2)', () => {
    expect(propUiFor('primaryAxisSizingMode')?.options).toEqual(['FIXED', 'AUTO'])
    expect(propUiFor('counterAxisSizingMode')?.options).toEqual(['FIXED', 'AUTO'])
  })

  it('typography applies to Text only', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.group === 'text') expect(ui.appliesTo, prop).toEqual(['Text'])
    }
  })

  /**
   * Layout holds two kinds of prop since the parity spec merged the sections:
   * the auto-layout ones a frame owns, and the dimension and child-
   * participation ones every element has. Only the first is frame-restricted.
   */
  it('restricts the auto-layout props to the containers that lay children out', () => {
    const AUTO_LAYOUT = [
      'layoutMode',
      'layoutWrap',
      'primaryAxisSizingMode',
      'counterAxisSizingMode',
      'primaryAxisAlignItems',
      'counterAxisAlignItems',
      'counterAxisAlignContent',
      'itemSpacing',
      'counterAxisSpacing',
      'itemReverseZIndex',
      'paddingLeft',
      'paddingRight',
      'paddingTop',
      'paddingBottom',
      'clipsContent',
    ]
    for (const prop of AUTO_LAYOUT) {
      // `Slot` joined them with ADR 0007 §1: a card decides how its body sits,
      // which is the whole difference between a slot and "an instance you may
      // add children to". The *fill* side owns none of this, but that is a
      // question about position rather than element — `sectionsFor` asks it.
      expect(propUiFor(prop)?.appliesTo, prop).toEqual(['Frame', 'Component', 'Slot'])
    }
  })

  it('leaves dimensions and child participation open to every element', () => {
    for (const prop of [
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'layoutGrow',
      'layoutAlign',
      'strokesIncludedInLayout',
    ]) {
      expect(propUiFor(prop)?.appliesTo, prop).toBeUndefined()
    }
  })

  it('every enum entry actually carries options', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.control === 'enum') expect(ui.options?.length, prop).toBeGreaterThan(0)
    }
  })

  it('gives the pin offsets number controls in the position group (H2)', () => {
    // Absent from PROP_TABLE by design (ADR 0011 §2), and present here: the
    // panel is the one place they are a control rather than a scene field.
    for (const prop of ['right', 'bottom', 'centerX', 'centerY']) {
      expect(propUiFor(prop)?.control).toBe('number')
      expect(propUiFor(prop)?.group).toBe('position')
    }
  })

  it('paint stacks, effects, constraints and dashes have real control kinds (C8)', () => {
    expect(propUiFor('fills')?.control).toBe('paint')
    expect(propUiFor('strokes')?.control).toBe('paint')
    expect(propUiFor('effects')?.control).toBe('effects')
    expect(propUiFor('constraints')?.control).toBe('constraints')
    expect(propUiFor('dashPattern')?.control).toBe('dashes')
  })

  it('vector geometry stays opaque — canvas vector mode is a different epic', () => {
    expect(propUiFor('vectorPaths')?.control).toBe('opaque')
    expect(propUiFor('arcData')?.control).toBe('opaque')
  })

  it('each axis pairs its near and far edge, plus the two classic pairs', () => {
    // x pairs right and y pairs bottom since the CSS revision: one axis, one
    // line, so the panel's edge rows sit in the same place whatever the pin.
    const paired = Object.entries(PROP_UI)
      .filter(([, ui]) => ui.pairs)
      .map(([name]) => name)
      .sort()
    expect(paired).toEqual([
      'blendMode',
      'bottom',
      'counterAxisSpacing',
      'fontSize',
      'fontWeight',
      'height',
      'itemSpacing',
      'letterSpacing',
      'lineHeight',
      'maxHeight',
      'maxWidth',
      'minHeight',
      'minWidth',
      'opacity',
      'right',
      'strokeAlign',
      'strokeBottomWeight',
      'strokeEndCap',
      'strokeLeftWeight',
      'strokeRightWeight',
      'strokeStartCap',
      'strokeTopWeight',
      'strokeWeight',
      'textAlignHorizontal',
      'textAlignVertical',
      'width',
      'x',
      'y',
    ])
  })
})

/**
 * Display naming (the Figma-parity spec, §3).
 *
 * The panel's users are Figma users, so every row says Figma's word rather
 * than §3.3's. The file never sees these: the authored name stays the patch
 * key and the file's spelling, and a label is presentation only.
 */
describe('display names', () => {
  it('every entry carries one, so no raw prop name reaches a user', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      expect(ui.label, `"${prop}" has no display label`).toBeTruthy()
    }
  })

  it('says what Figma says, where Figma differs from §3.3', () => {
    const wanted: Record<string, string> = {
      characters: 'Content',
      itemSpacing: 'Gap',
      counterAxisSpacing: 'Wrap gap',
      layoutMode: 'Direction',
      layoutWrap: 'Wrap',
      clipsContent: 'Clip content',
      strokeAlign: 'Position',
      strokeWeight: 'Weight',
      strokeCap: 'Cap',
      strokeJoin: 'Join',
      strokesIncludedInLayout: 'Include stroke in layout',
      fontFamily: 'Font',
      fontWeight: 'Style',
      fontSize: 'Size',
      textAutoResize: 'Resizing',
      textCase: 'Case',
      textDecoration: 'Decoration',
      layoutGrow: 'Grow',
      layoutAlign: 'Align self',
      layoutPositioning: 'Placement',
      isMask: 'Use as mask',
      cornerRadius: 'Corner radius',
      cornerSmoothing: 'Corner smoothing',
      blendMode: 'Blend mode',
      itemReverseZIndex: 'First layer on top',
    }
    for (const [prop, label] of Object.entries(wanted)) {
      expect(propUiFor(prop)?.label, prop).toBe(label)
    }
  })

  it('keeps the terse ones terse — a paired row has no room for a sentence', () => {
    expect(propUiFor('x')?.label).toBe('X')
    expect(propUiFor('width')?.label).toBe('W')
    expect(propUiFor('height')?.label).toBe('H')
    expect(propUiFor('minWidth')?.label).toBe('Min width')
  })
})

/**
 * Enum options read as Figma's words too, while the file keeps UIDX's
 * canonical spelling (ADR 0002). The prettifier covers the many; the
 * overrides cover the few where Figma's word is not the value's.
 */
describe('enum option labels', () => {
  it('title-cases a screaming-snake value', () => {
    expect(optionLabelFor('primaryAxisAlignItems', 'SPACE_BETWEEN')).toBe('Space between')
    expect(optionLabelFor('blendMode', 'COLOR_BURN')).toBe('Color burn')
  })

  it("uses Figma's word where it differs from the value", () => {
    expect(optionLabelFor('textAutoResize', 'NONE')).toBe('Fixed size')
    expect(optionLabelFor('textAutoResize', 'HEIGHT')).toBe('Auto height')
    expect(optionLabelFor('textAutoResize', 'WIDTH_AND_HEIGHT')).toBe('Auto width')
    expect(optionLabelFor('primaryAxisSizingMode', 'AUTO')).toBe('Hug')
    expect(optionLabelFor('primaryAxisSizingMode', 'FIXED')).toBe('Fixed')
  })

  it('covers every option of every enum', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.control !== 'enum') continue
      for (const option of ui.options ?? []) {
        expect(optionLabelFor(prop, option), `${prop}.${option}`).toBeTruthy()
      }
    }
  })

  it('never collides inside one domain — two options reading alike is unusable', () => {
    for (const [prop, ui] of Object.entries(PROP_UI)) {
      if (ui.control !== 'enum') continue
      const labels = (ui.options ?? []).map((o) => optionLabelFor(prop, o))
      expect(new Set(labels).size, `${prop} has duplicate option labels`).toBe(labels.length)
    }
  })

  it('leaves a value it does not know alone, rather than inventing one', () => {
    expect(optionLabelFor('notAProp', 'WHATEVER')).toBe('Whatever')
  })
})

/**
 * Section structure, UI3's (the parity spec, §2).
 *
 * The moves that matter: Position keeps "where it is" and Layout takes "how
 * it sizes", which dissolves the separate layout-child section; a stroke's
 * participation in layout is a layout fact; and a Text layer leads with its
 * content.
 */
describe('sections follow UI3', () => {
  const groupOf = (prop: string) => propUiFor(prop)?.group

  it('gives Layout the dimensions, and Position only where the node sits', () => {
    for (const prop of ['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight']) {
      expect(groupOf(prop), prop).toBe('layout')
    }
    for (const prop of ['x', 'y', 'rotation', 'constraints', 'layoutPositioning']) {
      expect(groupOf(prop), prop).toBe('position')
    }
  })

  it('folds the layout-child props into Layout, so there is one layout section', () => {
    expect(groupOf('layoutGrow')).toBe('layout')
    expect(groupOf('layoutAlign')).toBe('layout')
    expect(SECTION_ORDER).not.toContain('layout-child')
  })

  it('puts a stroke inside layout where Figma does — it is a layout fact', () => {
    expect(groupOf('strokesIncludedInLayout')).toBe('layout')
  })

  it('no longer restricts Layout to frames — dimensions belong to every element', () => {
    expect(propUiFor('width')?.appliesTo).toBeUndefined()
    expect(propUiFor('layoutMode')?.appliesTo).toEqual(['Frame', 'Component', 'Slot'])
  })

  it('keeps Content alone in Text, with the type settings in Typography', () => {
    // Figma's split: the Text section at the top carries the layer's content
    // and nothing else; font, size and spacing are Typography, further down.
    expect(fieldOrderFor('text')).toEqual(['characters'])
    expect(propUiFor('fontFamily')?.group).toBe('typography')
    expect(propUiFor('fontSize')?.group).toBe('typography')
    expect(propUiFor('textCase')?.group).toBe('typography')
    expect(SECTION_LABEL.typography).toBe('Typography')
  })

  it('keeps text content and typography together before appearance', () => {
    const order = sectionOrderFor('Text')
    expect(order.indexOf('typography')).toBe(order.indexOf('text') + 1)
    expect(order.indexOf('typography')).toBeLessThan(order.indexOf('appearance'))
    expect(order.indexOf('typography')).toBeLessThan(order.indexOf('fill'))
  })

  it('leads text with its content and other layers with geometry', () => {
    expect(sectionOrderFor('Text')[0]).toBe('text')
    expect(sectionOrderFor('Frame')[0]).toBe('position')
    expect(sectionOrderFor('Text')).toEqual([...new Set(sectionOrderFor('Text'))])
  })

  it('orders a section by the spec, not by declaration accident', () => {
    const appearance = fieldOrderFor('appearance')
    expect(appearance[0]).toBe('opacity')
    expect(appearance[1]).toBe('cornerRadius')
    // `visible` renders only while a property drives it, and Figma puts that
    // pill after the section's own fields rather than above them.
    expect(appearance.at(-1), 'the boolean pill trails the section').toBe('visible')
  })

  it('keeps every group reachable from every element order', () => {
    for (const element of ['Text', 'Frame'] as const) {
      for (const group of sectionOrderFor(element)) {
        expect(SECTION_LABEL[group], group).toBeTruthy()
      }
    }
  })
})
