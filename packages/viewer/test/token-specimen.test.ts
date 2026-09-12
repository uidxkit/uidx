import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TokenSpecimen from '../src/TokenSpecimen.vue'
import type { TokenRow } from '../src/tokens-view-model'

const row: TokenRow = {
  address: 'space#md',
  name: 'md',
  type: 'FLOAT',
  category: 'spacing',
  scopes: ['SPACING'],
  description: '',
  deprecated: false,
  file: 'tokens.uidx',
  dependents: 0,
  cells: [{ mode: 'default', authored: '1rem', resolved: '1rem', chain: [] }],
}

describe('visual token specimens', () => {
  it('resolves rem spacing against the document root and keeps oversized values inside the preview', async () => {
    const specimen = mount(TokenSpecimen, { props: { row, rootFontSize: 20 } })
    expect(specimen.attributes('style')).toContain('--sample-length: 20px')
    await specimen.setProps({ cell: { mode: 'large', authored: 999, resolved: 999, chain: [] } })
    expect(specimen.attributes('style')).toContain('--sample-length: 44px')
    expect(specimen.attributes('aria-label')).toContain('scaled to fit')
  })

  it('shows a broken selected mode as unresolved rather than substituting another mode', () => {
    const broken = {
      mode: 'dark',
      authored: '{space#missing}',
      resolved: null,
      chain: ['space#missing'],
      broken: 'Missing token',
    }
    const specimen = mount(TokenSpecimen, { props: { row, cell: broken } })
    expect(specimen.find('.unresolved').exists()).toBe(true)
    expect(specimen.find('.space-sample').exists()).toBe(false)
  })

  it('previews font weight as weight rather than treating it as a font size', () => {
    const specimen = mount(TokenSpecimen, {
      props: {
        row: {
          ...row,
          category: 'typography',
          scopes: ['FONT_WEIGHT'],
          cells: [{ mode: 'default', authored: 700, resolved: 700, chain: [] }],
        },
      },
    })
    expect(specimen.attributes('style')).toContain('font-weight: 700')
    expect(specimen.attributes('style')).not.toContain('font-size')
  })
})
