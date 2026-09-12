export { run, USAGE, type Io } from './cli.js'
export {
  check,
  renderJson,
  renderText,
  NoMatchesError,
  type CheckOptions,
  type CheckResult,
  type FileReport,
} from './commands/check.js'
export {
  fmt,
  applyFmt,
  renderFmt,
  migrateSource,
  type FmtOptions,
  type FmtResult,
  type FmtFileResult,
  type FmtStatus,
} from './commands/fmt.js'
export {
  findManifest,
  readManifest,
  documentMembers,
  loadDocument,
  isMember,
  ManifestError,
  MANIFEST_NAME,
  type Manifest,
  type FoundManifest,
  type LoadedDocument,
} from '@uidx/server/document'
export {
  buildSymbolTable,
  suggest,
  WORKSPACE_CODES,
  type SymbolEntry,
  type SymbolKind,
  type SymbolResult,
  type SymbolTable,
  type PageSource,
} from '@uidx/server/symbols'

export { initProject } from './commands/init.js'
