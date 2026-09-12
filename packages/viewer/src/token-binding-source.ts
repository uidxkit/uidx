import type { JsonValue } from '@uidx/format'
import type { TokenIndex } from '@uidx/schema'

/** Selection-aware values shared by the inspector's compound controls. */
export interface TokenBindingSource {
  tokens?: ReadonlyMap<string, JsonValue>
  tokenIndex?: TokenIndex
  bindings: Readonly<Record<string, string>>
}

export interface TokenDetachWrite {
  prop: string
  value: JsonValue
}
