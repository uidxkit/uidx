import type { VariableScope } from '@uidx/format'
import type { TokenCategory, TokenRow, TokenTier } from './tokens-view-model'

export const TOKEN_TIERS: {
  id: TokenTier
  number: string
  label: string
  title: string
  description: string
  example: string
}[] = [
  {
    id: 'primitive',
    number: '01',
    label: 'Primitive',
    title: 'The raw values',
    description: 'Reusable scales. The starting point for color, space, and type.',
    example: 'blue-500 · space-4',
  },
  {
    id: 'semantic',
    number: '02',
    label: 'Semantic',
    title: 'The design decisions',
    description: 'Purposeful names that give values meaning across the system.',
    example: 'text-primary · surface-muted',
  },
  {
    id: 'component',
    number: '03',
    label: 'Component',
    title: 'The specific choices',
    description: 'Decisions scoped to one component, usually linked to semantic tokens.',
    example: 'button-background · input-radius',
  },
]

export const TOKEN_TYPES: Record<
  TokenCategory,
  { label: string; glyph: string; description: string }
> = {
  color: { label: 'Color', glyph: '◉', description: 'Fills, text, borders, and effects.' },
  spacing: {
    label: 'Spacing',
    glyph: '↔',
    description: 'The distance within and between regions.',
  },
  typography: {
    label: 'Typography',
    glyph: 'Aa',
    description: 'The family, size, weight, and rhythm of text.',
  },
  radius: { label: 'Radius', glyph: '⌜', description: 'The curvature of a corner.' },
  size: { label: 'Size', glyph: '□', description: 'Width and height.' },
  opacity: {
    label: 'Opacity',
    glyph: '◐',
    description: 'How transparent a visual property appears.',
  },
  stroke: { label: 'Stroke', glyph: '━', description: 'The thickness of a line or border.' },
  effect: { label: 'Effect', glyph: '≋', description: 'A numeric property of a shadow or blur.' },
  number: {
    label: 'Number',
    glyph: '#',
    description: 'A numeric value without a specific visual scope.',
  },
  text: { label: 'Text', glyph: 'T', description: 'Reusable text content.' },
  toggle: { label: 'Boolean', glyph: '⊙', description: 'An on or off decision.' },
}

const SCOPE_LABELS: Record<VariableScope, string> = {
  ALL_SCOPES: 'Any compatible property',
  TEXT_CONTENT: 'Text content',
  CORNER_RADIUS: 'Corner curvature',
  WIDTH_HEIGHT: 'Width & height',
  GAP: 'Gap',
  SPACING: 'Padding & spacing',
  ALL_FILLS: 'Any fill',
  FRAME_FILL: 'Surface fill',
  SHAPE_FILL: 'Shape fill',
  TEXT_FILL: 'Text color',
  STROKE_COLOR: 'Border color',
  STROKE_FLOAT: 'Stroke width',
  EFFECT_FLOAT: 'Effect amount',
  EFFECT_COLOR: 'Effect color',
  OPACITY: 'Transparency',
  FONT_FAMILY: 'Font family',
  FONT_STYLE: 'Font style',
  FONT_WEIGHT: 'Font weight',
  FONT_SIZE: 'Font size',
  LINE_HEIGHT: 'Line height',
  LETTER_SPACING: 'Letter spacing',
  PARAGRAPH_SPACING: 'Paragraph spacing',
  PARAGRAPH_INDENT: 'Paragraph indent',
}

export function visualRole(row: TokenRow): string {
  const specific = (row.inferredScopes ?? row.scopes).filter((scope) => scope !== 'ALL_SCOPES')
  return specific.length
    ? specific.map((scope) => SCOPE_LABELS[scope]).join(' · ')
    : TOKEN_TYPES[row.category].description
}

export function tierLabel(tier?: TokenTier): string {
  return TOKEN_TIERS.find((item) => item.id === tier)?.label ?? 'No tier assigned'
}

export function hasLengthUnit(row: TokenRow): boolean {
  const scopes = row.inferredScopes ?? row.scopes
  return row.type === 'FLOAT' && row.category !== 'opacity' && !scopes.includes('FONT_WEIGHT')
}
