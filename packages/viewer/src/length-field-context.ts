import type { InjectionKey, Ref } from 'vue'
import type { JsonValue } from '@uidx/format'

export interface LengthFieldContext {
  rootFontSize: Readonly<Ref<number>>
  valueFor: (prop: string) => JsonValue | undefined
}

export const LENGTH_FIELD_CONTEXT: InjectionKey<LengthFieldContext> = Symbol('length-field-context')
