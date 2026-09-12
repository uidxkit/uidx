import type { JsonValue } from '@uidx/format'

export interface ComponentEntry {
  name: string
  file: string
  address: string
  status: string | null
  props: { name: string; type: string; default: JsonValue | undefined }[]
  slots: string[]
  variants: string[]
}

export interface InstanceEntry {
  address: string
  file: string
  component: string
}

export interface VariableEntry {
  address: string
  file: string
  collection: string
  name: string
  type: string
}

export interface PageEntry {
  file: string
  id: string
  kind: 'page' | 'tokens'
  /** `##` headings from the intent markdown, in source order. */
  headings: string[]
  /** Direct children of the root, the page's skeleton. */
  topLevel: { name: string; element: string; address: string }[]
  nodeCount: number
}

export interface DocumentIndex {
  manifestId: string
  pages: Map<string, PageEntry>
  components: Map<string, ComponentEntry>
  instances: InstanceEntry[]
  variables: Map<string, VariableEntry>
  /** Every instance of a component, across every page. */
  usesOfComponent(name: string): InstanceEntry[]
  /** Every `prop={"{collection#name}"}` alias pointing at a variable. */
  usesOfVariable(address: string): { address: string; file: string; prop: string }[]
}
