export {
  toSceneGraph,
  layOutEntity,
  instanceDefinition,
  instanceFills,
  instanceSceneProps,
  scenePropsFor,
  scenePropFor,
  slotOfSceneNode,
  variantFor,
  NODE_TYPE,
  type AddressMap,
  type InstanceFills,
  type MutableAddressMap,
  type SceneResult,
} from './to-scene.js'
export {
  arrangeVariants,
  VARIANT_GAP,
  VARIANT_PADDING,
  type VariantArrangement,
  type VariantBox,
  type VariantPlacement,
} from './variant-layout.js'
export {
  diffDocuments,
  applyChanges,
  wrappedFrameUpdate,
  type ApplyResult,
  type InstanceVersion,
  type SceneChange,
} from './reconcile.js'
export { fromSceneChange, type ChangeContext } from './from-scene.js'
export {
  hasAuthoredGeometry,
  isDerivedPosition,
  isDerivedSize,
  isPinnedAxis,
  isPositionAuthored,
  isSizeAuthored,
  type GeometryNode,
  type NodeLookup,
} from './authorship.js'
export { KNOWN_PROPS, PIN_PROPS, STRUCTURAL_PROPS, isKnownProp } from './known-props.js'
export * from './instance-box.js'
export {
  instanceBase,
  instancePreview,
  type InstanceBase,
  type InstanceBoxTarget,
  type InstanceLayout,
  type InstancePreviewUpdate,
} from './instance-panel.js'
export {
  pinFrom,
  pinWrites,
  resolvedBox,
  type Box,
  type Pin,
  type PinAxis,
  type PinAxisName,
  type PinWrites,
} from './pins.js'
export { createPinMap, type MutablePinMap, type PinMap } from './pin-index.js'
export { resolvePins } from './pin-pass.js'
export {
  CREATABLE_ELEMENTS,
  INSERTABLE_ELEMENTS,
  createSpec,
  isCreatable,
  type CreatableElement,
  type InsertableElement,
  type Placement,
} from './create.js'
export { defaultFor, engineAnswers, DECLARED_DEFAULTS } from './defaults.js'
export {
  IDENTITY_PROPS,
  PROP_TABLE,
  isIdentityProp,
  mappingFor,
  normalizeFills,
  type PropMapping,
} from './prop-table.js'
export {
  PROP_UI,
  PROP_UI_OPT_OUT,
  SECTION_LABEL,
  SECTION_ORDER,
  SEGMENTED_MAX_OPTIONS,
  fieldOrderFor,
  optionLabelFor,
  propUiFor,
  sectionOrderFor,
  type PropGroup,
  type PropUi,
} from './prop-ui.js'
export { applyTokens, tokenAddresses, resolveTokenValues, type TokenResult } from './tokens.js'
export { buildDependentsIndex, type Dependent, type DependentsIndex } from './symbol-deps.js'
export {
  deleteCollection,
  deleteToken,
  renameCollection,
  renameComponent,
  renameToken,
  rewriteAliases,
  setCollectionModes,
  type ModeShape,
  type DeletePlan,
  type DeleteCollectionPlan,
  type RefactorPlan,
} from './refactor.js'
export {
  buildTokenIndex,
  IMPLICIT_MODE,
  type CollectionInfo,
  type TokenEntry,
  type TokenIndex,
} from './token-index.js'
export {
  defaultTuple,
  mergeModes,
  modeTupleKey,
  TokenResolver,
  tupleAt,
  type ModeTuple,
} from './resolve-modes.js'
export {
  EMPTY_COVERAGE,
  mergeCoverage,
  readGlyphCoverage,
  type GlyphCoverage,
} from './glyph-coverage.js'
export {
  STROKE_ENDPOINT_CAPS,
  isStrokeEndpointProp,
  withStrokeEndpoints,
  strokeEndpointValue,
  type StrokeEndpointProp,
} from './stroke-endpoints.js'
export { auditDesignSystem } from './design-system-audit.js'
export {
  axesOf,
  contractJson,
  DEFAULT_STATE,
  defaultVariantName,
  deriveVariants,
  derivedDocument,
  derivesVariants,
  enumValues,
  modelByRef,
  nodeNamed,
  partNode,
  propSpec,
  ROOT_PART,
  sampleAt,
  specBindings,
  STATE_AXIS,
  stateAxis,
  styleTarget,
  visualAxes,
  modelIndex,
  modelOfType,
  stateKind,
  INTERACTION_STATES,
  type ModelIndex,
  defaultVariantAddress,
  derivedTarget,
  type DerivedTarget,
  modelSamples,
  sampleCount,
  repeatOf,
  repeatListType,
  repeatModel,
  type RepeatAttrs,
  type RepeatScope,
} from './design-system.js'
export { DTCG_VERSION, fromDtcg, toDtcg, type DtcgExport, type DtcgImport } from './dtcg.js'
