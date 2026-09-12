export {
  parse,
  parseOrThrow,
  resolve,
  resolveParent,
  relativeAddress,
  addressOf,
  addressDepth,
  isWithin,
  assertOffsetInvariant,
  findOpenTagEnd,
  STATUSES,
} from './parse.js'
export { applyPatch, applyPatches, PatchError, type PatchResult } from './patch.js'
export { predictDocument } from './predict.js'
export { inversePatches, toNodeSpec } from './inverse.js'
export { diffToPatches } from './diff-patches.js'
export { applyPatchesIncremental, type IncrementalResult } from './incremental.js'
export {
  BINDING_RULE,
  bindingFits,
  componentProps,
  instanceProps,
  isPropertyType,
  matchesType,
  propertyBinding,
  slotFills,
  slots,
  type PropertyProblem,
  type SlotProblem,
} from './component-props.js'
export {
  AXIS_FORBIDDEN,
  componentVariants,
  defaultCombination,
  hasVariants,
  variantCoordinates,
  variantName,
  type ComponentVariants,
  type VariantCoordinates,
  type VariantProblem,
} from './variants.js'
export { emitTree, emitDocument, toSpec, autoName, INDENT_UNIT } from './emit.js'
export { assetPathProblem, assetRefs, DEFAULT_ASSET_GLOBS, type AssetRef } from './assets.js'
export {
  serializeValue,
  serializeJson5,
  parseExpression,
  roundNumber,
  ValueError,
} from './values.js'
export {
  CODES,
  diagnostic,
  formatDiagnostic,
  positionAt,
  lineStartsOf,
  positionIn,
  UidxError,
} from './diagnostics.js'
export {
  isAlias,
  aliasTarget,
  fitsVariableType,
  toAlias,
  variableTypeOf,
  looksLikeVariableAddress,
  type Alias,
} from './alias.js'
export {
  COMPONENT_CHILD_ELEMENTS,
  CONTAINER_ELEMENTS,
  ELEMENTS,
  COLLECTION_CHILD_ELEMENTS,
  ENTITY_SEP,
  METADATA_ATTRS,
  INSTANCE_CHILD_ELEMENTS,
  legalChildElementsOf,
  NODE_CHILD_ELEMENTS,
  PAGE_CHILD_ELEMENTS,
  PATH_SEP,
  PROPERTY_FIELD,
  PROPERTY_TYPES,
  ROOT_ELEMENTS,
  TOKEN_ELEMENTS,
  TOKENS_CHILD_ELEMENTS,
  VARIABLE_CHILD_ELEMENTS,
  VARIABLE_SCOPES,
  VARIABLE_TYPES,
  type PropertyDeclaration,
  type PropertyType,
  type VariableScope,
  type VariableType,
  type Diagnostic,
  type JsonValue,
  type ParseResult,
  type Range,
  type Severity,
  type UidxAttr,
  type UidxDocument,
  type SceneElement,
  type UidxElement,
  type UidxNode,
  type UidxNodeSpec,
  type UidxPatch,
} from './types.js'
export { SCOPE_FOR_PROP, scopesForProp } from './scope-for-prop.js'
export * from './lengths.js'
