/**
 * The starter design system `uidx init --design-system` writes: tokens in
 * three tiers (a palette, semantic colours with light and dark modes, a
 * space, radius and type scale) and one component, Button, written the way
 * ADRs 0012–0017 say a component is written — an anatomy drawn once, a
 * contract, a styles table and behaviour rules. Enough to see every region
 * working on the first `npm run uidx`, and to copy from.
 */
const rgb = (hex: string): string => {
  const channel = (at: number) =>
    Math.round((parseInt(hex.slice(at, at + 2), 16) / 255) * 1000) / 1000
  return `{{ r: ${channel(1)}, g: ${channel(3)}, b: ${channel(5)}, a: 1 }}`
}

const PALETTE: [string, string][] = [
  ['white', '#ffffff'],
  ['gray-50', '#f8f9fb'],
  ['gray-100', '#eef0f4'],
  ['gray-300', '#c9ced8'],
  ['gray-500', '#6b7280'],
  ['gray-800', '#1f2430'],
  ['gray-900', '#12151c'],
  ['blue-500', '#2563eb'],
  ['blue-600', '#1d4ed8'],
  ['blue-400', '#60a5fa'],
  ['red-500', '#dc2626'],
]

const SEMANTIC: [string, string, string][] = [
  ['surface', 'white', 'gray-900'],
  ['surface-raised', 'gray-50', 'gray-800'],
  ['text', 'gray-900', 'gray-50'],
  ['text-muted', 'gray-500', 'gray-300'],
  ['border', 'gray-300', 'gray-500'],
  ['accent', 'blue-500', 'blue-400'],
  ['accent-hover', 'blue-600', 'blue-500'],
  ['on-accent', 'white', 'gray-900'],
  ['danger', 'red-500', 'red-500'],
]

export const STARTER_TOKENS = `---
id: tokens
---

The foundations every component references: a raw palette, semantic colours
that change with the light and dark modes, and the space, radius and type
scales. Components alias the semantic tier, never the palette.

## Visual Contract

<Tokens>
  <Collection name="palette">
${PALETTE.map(([name, hex]) => `    <Variable name="${name}" type="COLOR" value=${rgb(hex)} />`).join('\n')}
  </Collection>
  <Collection name="color" modes={['light', 'dark']}>
${SEMANTIC.map(
  ([name, light, dark]) => `    <Variable name="${name}" type="COLOR">
      <Mode name="light" value="{palette#${light}}" />
      <Mode name="dark" value="{palette#${dark}}" />
    </Variable>`,
).join('\n')}
  </Collection>
  <Collection name="space">
    <Variable name="xs" type="FLOAT" value={4} />
    <Variable name="sm" type="FLOAT" value={8} />
    <Variable name="md" type="FLOAT" value={12} />
    <Variable name="lg" type="FLOAT" value={16} />
  </Collection>
  <Collection name="radius">
    <Variable name="sm" type="FLOAT" value={4} />
    <Variable name="md" type="FLOAT" value={6} />
    <Variable name="full" type="FLOAT" value={999} />
  </Collection>
  <Collection name="type">
    <Variable name="sm" type="FLOAT" value={12} />
    <Variable name="md" type="FLOAT" value={14} />
    <Variable name="lg" type="FLOAT" value={16} />
  </Collection>
  <Collection name="opacity">
    <Variable name="disabled" type="FLOAT" value={0.45} />
  </Collection>
</Tokens>
`

export const STARTER_BUTTON = `---
id: button
---

The one control every screen has. Emphasis and size are visual props, so the
canvas draws every combination from the styles table below; select one and
change it to write its row.

## Visual Contract

<Page>
  <Component name="Button" status="draft"
    layoutMode="HORIZONTAL" primaryAxisSizingMode="AUTO" counterAxisSizingMode="AUTO"
    primaryAxisAlignItems="CENTER" counterAxisAlignItems="CENTER"
    itemSpacing="{space#xs}" paddingLeft="{space#md}" paddingRight="{space#md}"
    paddingTop="{space#sm}" paddingBottom="{space#sm}" cornerRadius="{radius#md}"
    fills="{color#accent}" strokes="{color#accent}" strokeWeight={1}>
    <Text name="label" characters="{label}" fontSize="{type#md}" fontWeight="MEDIUM" fills="{color#on-accent}" />
  </Component>
</Page>

<Styles>
  <Style emphasis="secondary" root:fills="{color#surface-raised}" root:strokes="{color#border}" label:fills="{color#text}" />
  <Style emphasis="danger" root:fills="{color#danger}" root:strokes="{color#danger}" />
  <Style size="small" root:paddingLeft="{space#sm}" root:paddingRight="{space#sm}" root:paddingTop="{space#xs}" root:paddingBottom="{space#xs}" label:fontSize="{type#sm}" />
  <Style state="hover" root:fills="{color#accent-hover}" root:strokes="{color#accent-hover}" />
  <Style state="hover" emphasis="secondary" root:fills="{color#surface}" />
  <Style state="focus" root:strokes="{color#text}" />
  <Style state="disabled" root:opacity="{opacity#disabled}" />
</Styles>

## Contract

<Props>
  <Prop name="label" type="string" sample="Save changes">The words on the button.</Prop>
  <Prop name="emphasis" type="'primary' | 'secondary' | 'danger'" default="primary" visual>How loudly it asks.</Prop>
  <Prop name="size" type="'medium' | 'small'" default="medium" visual>Padding and type scale.</Prop>
  <Prop name="disabled" type="boolean" default={false} visual>Inert and dimmed.</Prop>
</Props>
<Events>
  <Event name="press">Fires once per activation, never while disabled.</Event>
</Events>
<Accessibility role="button" keyboard="Enter and Space activate" />

## Behavior

- activation: click, Enter or Space fires \`press\` once.
- disabled: no activation and no events while \`disabled\`; still announced as a disabled button.

## Examples

<Example name="secondary">
  <Set at="emphasis" value="secondary" />
</Example>
`

/** The pull-request check `uidx init --ci` writes to `.github/workflows/uidx.yml`. */
export const CI_WORKFLOW = `name: Design system

# Written by \`uidx init --ci\`. On every pull request: the design files must
# check clean, application code must stay on the design system, and the
# design-system changes — breaking ones marked — are posted on the PR.

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  uidx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm ci
      - name: Check the design files
        run: npx --no-install uidx check .uidx
      - name: Keep application code on the design system
        run: npx --no-install uidx lint src
      - name: Design-system changes
        run: npx --no-install uidx diff --base origin/\${{ github.base_ref }} > uidx-diff.md
      - name: Post the changes on the pull request
        uses: actions/github-script@v7
        with:
          script: |
            const body = require('fs').readFileSync('uidx-diff.md', 'utf8')
            const marker = '<!-- uidx-design-diff -->'
            const { owner, repo } = context.repo
            const issue_number = context.issue.number
            const comments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number })
            const mine = comments.find((c) => c.body?.includes(marker))
            const text = marker + '\\n' + body
            if (mine) await github.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body: text })
            else await github.rest.issues.createComment({ owner, repo, issue_number, body: text })
      - name: Fail on breaking changes
        run: npx --no-install uidx diff --base origin/\${{ github.base_ref }} --fail-on-breaking > /dev/null
`
