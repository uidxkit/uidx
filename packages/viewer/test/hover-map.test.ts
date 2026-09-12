import { describe, expect, it } from 'vitest'
import { hoverTargetFor } from '../src/hover-map'

describe('hoverTargetFor', () => {
  it('maps the gaps to the spacing bands', () => {
    expect(hoverTargetFor('itemSpacing')).toEqual({ kind: 'spacing-value' })
    expect(hoverTargetFor('counterAxisSpacing')).toEqual({ kind: 'spacing-value' })
  })

  it('maps each padding prop to its own side', () => {
    expect(hoverTargetFor('paddingTop')).toEqual({ kind: 'padding-value', side: 'top' })
    expect(hoverTargetFor('paddingRight')).toEqual({ kind: 'padding-value', side: 'right' })
    expect(hoverTargetFor('paddingBottom')).toEqual({ kind: 'padding-value', side: 'bottom' })
    expect(hoverTargetFor('paddingLeft')).toEqual({ kind: 'padding-value', side: 'left' })
  })

  it('maps the arrangement props to the children', () => {
    for (const prop of [
      'layoutMode',
      'layoutWrap',
      'primaryAxisAlignItems',
      'counterAxisAlignItems',
      'counterAxisAlignContent',
    ]) {
      expect(hoverTargetFor(prop), prop).toEqual({ kind: 'children' })
    }
  })

  it('maps geometry to the node itself', () => {
    for (const prop of [
      'x',
      'y',
      'width',
      'height',
      'rotation',
      'cornerRadius',
      'topLeftRadius',
      'topRightRadius',
      'bottomLeftRadius',
      'bottomRightRadius',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
    ]) {
      expect(hoverTargetFor(prop), prop).toEqual({ kind: 'node' })
    }
  })

  it('lights nothing for props the canvas cannot show', () => {
    expect(hoverTargetFor('fills')).toBeNull()
    expect(hoverTargetFor('opacity')).toBeNull()
    expect(hoverTargetFor('characters')).toBeNull()
  })
})
