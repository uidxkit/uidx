import type { ConfigChange, Diagnostic, WriteResult } from './headless'

export type { Diagnostic, WriteResult } from './headless'

/**
 * Every word the Contract, Connect and Code tabs say about their state: the
 * status line's titles, details and actions, the empty states, and the (i)
 * teaching copy behind each section header.
 *
 * One module so the three tabs word and colour one fault identically. A
 * library that cannot be read is "Library file not found" on every tab, with
 * only the detail and the actions differing by what that tab can do about
 * it; the raw server text survives, but only behind "Details". The server's
 * `code` field is preferred when it sends one, and today's raw strings are
 * matched by pattern otherwise, so an older server still reads well.
 *
 * Pure: no Vue, no fetch. The tabs and the shell build items from here and
 * hand them to `InspectorStatus` and `InspectorEmpty`.
 */

/** How bad a status item is. Danger stops work; warn is a finding; info is news. */
export type Tone = 'danger' | 'warn' | 'info'

/** What a status row, an empty state or a hint link asks the shell to do. */
export interface MessageAction {
  label: string
  run:
    | 'retry-library'
    | 'retry-config'
    | 'retry-code'
    | 'open-project'
    | 'open-contract'
    | 'select'
    | 'open-component'
    | 'make-component'
  /** `open-project`: 'library' or 'output'; `select`: an address; `open-component`: a name. */
  arg?: string
}

/** One row of a status item's list: a diagnostic, a file, a stray binding. */
export interface StatusRow {
  label: string
  /** The untrimmed text, for the row's title. */
  full?: string
  /** A second, faint line: where the row comes from. */
  meta?: string
  action?: MessageAction
}

/** One entry of a tab's status line. */
export interface StatusItem {
  /** Stable per kind of fault (`library`, `config`, `code`, `blocked:<file>`…), for keys and tests. */
  id: string
  tone: Tone
  /** At most six words; the bar shows it on one line. */
  title: string
  /** One or two short sentences, clamped to two lines. */
  detail?: string
  /** A file or folder the fault is about; shown shortened, in full in its title. */
  path?: string
  pathTitle?: string
  /** Replaces the bar's `+N` count, e.g. '3 problems'. */
  count?: string
  rows?: StatusRow[]
  actions?: MessageAction[]
  /** The server's own words, behind "Details". */
  raw?: string
}

/** A transport or server failure, by class. `raw` is what was thrown, verbatim. */
export interface Failure {
  code:
    | 'not-found'
    | 'no-access'
    | 'is-folder'
    | 'invalid-json'
    | 'unavailable'
    | 'timeout'
    | 'network'
    | 'unknown'
  raw: string
}

/** The three tabs this module words. */
export type Face = 'contract' | 'connect' | 'code'

/* ------------------------------------------------------------ helpers */

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** `n problem(s)`, as every count in the tabs reads. */
export const problems = (n: number): string => plural(n, 'problem')

/** The order the status line lists items in, most severe first. */
export const TONE_RANK: Record<Tone, number> = { danger: 0, warn: 1, info: 2 }

/** Items most severe first; equal tones keep their order. */
export function sortByTone(items: readonly StatusItem[]): StatusItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => TONE_RANK[a.item.tone] - TONE_RANK[b.item.tone] || a.index - b.index)
    .map(({ item }) => item)
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).pop() ?? path

/**
 * A path short enough for one line of the panel: the first named segment
 * (with any leading `..` or `/`) and as many trailing segments as fit,
 * joined by an ellipsis — '../vendor/…/custom-elements.json'. The full path
 * belongs in the element's title.
 */
export function shortPath(p: string, max = 34): string {
  if (p.length <= max) return p
  const parts = p.split('/')
  let lead = 0
  while (
    lead < parts.length - 1 &&
    (parts[lead] === '' || parts[lead] === '.' || parts[lead] === '..')
  )
    lead += 1
  if (lead >= parts.length - 1) return p
  const head = parts.slice(0, lead + 1).join('/')
  const rest = parts.slice(lead + 1)
  let tail = [rest.pop()!]
  while (rest.length > 1 && `${head}/…/${[rest.at(-1), ...tail].join('/')}`.length <= max)
    tail = [rest.pop()!, ...tail]
  if (rest.length === 0) return p
  const short = `${head}/…/${tail.join('/')}`
  return short.length <= max || tail.length > 1 ? short : `…/${tail.join('/')}`
}

/**
 * A library description without its Markdown, on one line: `code`, *em*,
 * _em_ and [links](url) become their text.
 */
export function plainText(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^\w*])\*([^*\n]+)\*(?=[^\w*]|$)/g, '$1$2')
    .replace(/(^|[^\w])_([^_\n]+)_(?=[^\w]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The first sentence of a library description, without its Markdown. */
export function firstSentence(text: string): string {
  const plain = plainText(text)
  const cut = plain.search(/[.!?] /)
  return cut === -1 ? plain : plain.slice(0, cut + 1)
}

const sentenceCase = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1)

/** The path an errno message names: `open '/abs/x.json'` → `/abs/x.json`. */
const pathIn = (raw: string): string | undefined =>
  /\b(?:open|mkdir|scandir|stat|lstat|rmdir|unlink|rename|copyfile|access|writeFile|readFile)\s+'([^']+)'/.exec(
    raw,
  )?.[1]

/* ------------------------------------------------------------ failures */

const SERVER_CODES: Record<string, Failure['code']> = {
  ENOENT: 'not-found',
  ENOTDIR: 'not-found',
  EACCES: 'no-access',
  EPERM: 'no-access',
  EROFS: 'no-access',
  EISDIR: 'is-folder',
  EJSON: 'invalid-json',
}

/**
 * Classifies anything a fetch to the uidx server can throw. The `code` a
 * newer server attaches wins; otherwise the message is matched, so the
 * classes hold for today's raw strings too.
 */
export function classifyFailure(error: unknown): Failure {
  const raw = error instanceof Error ? error.message : String(error)
  const sent = (error as { code?: unknown } | null)?.code
  if (typeof sent === 'string' && SERVER_CODES[sent]) return { code: SERVER_CODES[sent], raw }
  const name = (error as { name?: unknown } | null)?.name
  if (name === 'TimeoutError') return { code: 'timeout', raw }
  if (/service is unavailable/i.test(raw)) return { code: 'unavailable', raw }
  if (/\bENOENT\b|\bENOTDIR\b/.test(raw)) return { code: 'not-found', raw }
  if (/\bEACCES\b|\bEPERM\b|\bEROFS\b/.test(raw)) return { code: 'no-access', raw }
  if (/\bEISDIR\b/.test(raw)) return { code: 'is-folder', raw }
  if (/timed out|TimeoutError/i.test(raw)) return { code: 'timeout', raw }
  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) return { code: 'network', raw }
  // An HTML error page where JSON was expected: the server, not the file.
  if (/Unexpected token '?<|<!doctype|<html/i.test(raw)) return { code: 'unavailable', raw }
  if (/not valid JSON|Unexpected token|in JSON at|JSON input|JSON\.parse/i.test(raw))
    return { code: 'invalid-json', raw }
  return { code: 'unknown', raw }
}

/** A transport failure's one-line explanation, or null when the class is about a file. */
function transportDetail(code: Failure['code']): string | null {
  if (code === 'timeout' || code === 'network') return "The server didn't respond."
  if (code === 'unavailable') return 'The server sent an unexpected response.'
  return null
}

/* ------------------------------------------------------------ actions */

/** The actions the tabs share, worded once. */
export const ACTION = {
  retryLibrary: { label: 'Retry', run: 'retry-library' },
  retryConfig: { label: 'Retry', run: 'retry-config' },
  retryCode: { label: 'Retry', run: 'retry-code' },
  chooseLibrary: { label: 'Choose library', run: 'open-project', arg: 'library' },
  fixInConnect: { label: 'Fix in Connect', run: 'open-project', arg: 'library' },
  openConnect: { label: 'Open Connect', run: 'open-project', arg: 'library' },
  setFolder: { label: 'Set folder', run: 'open-project', arg: 'output' },
  changeFolder: { label: 'Change folder', run: 'open-project', arg: 'output' },
  chooseTargets: { label: 'Choose targets', run: 'open-project', arg: 'output' },
  openContract: { label: 'Open contract', run: 'open-contract' },
  showParts: { label: 'Show', run: 'open-contract' },
  makeComponent: { label: 'Make component', run: 'make-component' },
} as const satisfies Record<string, MessageAction>

/** 'Open List': shows a component defined on another page. */
export const openComponent = (name: string): MessageAction => ({
  label: `Open ${name}`,
  run: 'open-component',
  arg: name,
})

/** 'Select Button': selects a layer by address. */
export const selectLayer = (name: string, address: string): MessageAction => ({
  label: `Select ${name}`,
  run: 'select',
  arg: address,
})

/* ------------------------------------------------------------ items */

const LIBRARY_TITLE: Record<Failure['code'], string> = {
  'not-found': 'Library file not found',
  'no-access': "Can't open the library file",
  'is-folder': 'Library path is a folder',
  'invalid-json': "Library file isn't valid JSON",
  timeout: "Server didn't respond",
  unavailable: 'Library service unavailable',
  network: "Can't reach the uidx server",
  unknown: "Can't read the library",
}

const LIBRARY_DETAIL: Record<Face, string> = {
  connect: 'Element and part checks are paused until it loads.',
  contract: 'Part checks are paused.',
  code: "Code can't render without it.",
}

/**
 * The headless library could not be read. The title is the same on every
 * tab; the detail says what this tab cannot do meanwhile, and the actions
 * are what it can do — choose a library where the chooser lives (Connect),
 * point there from elsewhere. A file fault names the file as `uidx.json`
 * configures it, with the absolute path the server tried in its title.
 */
export function libraryItem(f: Failure, face: Face, configured: string | null): StatusItem {
  const aboutFile = !transportDetail(f.code)
  const tried = pathIn(f.raw)
  const path = aboutFile ? (configured ?? tried) : undefined
  return {
    id: 'library',
    tone: 'danger',
    title: LIBRARY_TITLE[f.code],
    detail: LIBRARY_DETAIL[face],
    ...(path ? { path, pathTitle: tried ?? path } : {}),
    actions: aboutFile
      ? [face === 'connect' ? ACTION.chooseLibrary : ACTION.fixInConnect, ACTION.retryLibrary]
      : [ACTION.retryLibrary],
    raw: f.raw,
  }
}

/** `uidx.json` could not be read, so Connect and Code have no configuration. */
export function configLoadItem(f: Failure): StatusItem {
  const transport = transportDetail(f.code)
  return {
    id: 'config',
    tone: 'danger',
    title:
      f.code === 'network'
        ? "Can't reach the uidx server"
        : f.code === 'timeout'
          ? "Server didn't respond"
          : f.code === 'invalid-json'
            ? "uidx.json isn't valid JSON"
            : "Can't read uidx.json",
    detail: transport ?? 'Connections and the output folder show once it loads.',
    actions: [ACTION.retryConfig],
    raw: f.raw,
  }
}

/** A change to `uidx.json` the server refused, where no field owns the error. */
export function saveItem(raw: string): StatusItem {
  const f = classifyFailure(raw)
  const detail =
    transportDetail(f.code) ?? (f.code === 'unknown' ? firstSentence(raw) || undefined : undefined)
  return {
    id: 'save',
    tone: 'danger',
    title: "Couldn't save the change",
    ...(detail ? { detail } : {}),
    ...(detail !== raw ? { raw } : {}),
  }
}

/**
 * The short text under the field a refused change came from. The server's
 * sentences are written for the CLI; these are the panel's.
 */
export function fieldErrorText(key: ConfigChange['key'], raw: string): string {
  const f = classifyFailure(raw)
  const transport = transportDetail(f.code)
  if (transport) return "Couldn't save. The server didn't respond."
  if (/output|where generated code goes/i.test(raw) && key === 'react')
    return 'Needs an output folder'
  if (/module/i.test(raw)) return 'Name the module to import from'
  if (/Name the folder/i.test(raw)) return 'Enter a folder'
  if (/library first/i.test(raw)) return 'Choose a library first'
  const sentence = firstSentence(raw).replace(/\.$/, '')
  return sentence.length && sentence.length <= 60 ? sentence : "Couldn't save the change"
}

/**
 * One diagnostic as a status row: the message without its trailing aside,
 * sentence-cased, with where it comes from as the meta line. The manifest
 * miss every new binding hits reads as 'Unknown part “spinner-track”'.
 */
export function shortDiagnostic(d: Pick<Diagnostic, 'file' | 'line' | 'message'>): {
  label: string
  full: string
  meta: string
} {
  const part = /part "([^"]+)"(?: \(bound to "[^"]+"\))? has no element in the manifest/.exec(
    d.message,
  )
  const label = part
    ? `Unknown part “${part[1]}”`
    : sentenceCase(d.message.replace(/\s*\([^()]*\)\s*$/, '').trim())
  return {
    label,
    full: `${d.file}:${d.line} ${d.message}`,
    meta: `${basename(d.file)} · line ${d.line}`,
  }
}

const isError = (d: Diagnostic): boolean => d.severity === 'error'

const sameFile = (a: string, b: string): boolean =>
  a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`) || basename(a) === basename(b)

/**
 * The Code tab's diagnostics: one item for the subject's own file, whose
 * rows link to its contract, and one 'Blocked by <file>' item per other file
 * — a component that uses a broken one cannot render either, and the fix is
 * over there. Without `ownFile` every problem counts as the subject's own.
 * Rows are all kept; the status line shows three and folds the rest.
 */
export function codeItems(diags: readonly Diagnostic[], ownFile?: string): StatusItem[] {
  const errors = diags.filter(isError)
  if (!errors.length) return []
  const own = ownFile === undefined ? errors : errors.filter((d) => sameFile(d.file, ownFile))
  const others = new Map<string, Diagnostic[]>()
  for (const d of errors) {
    if (own.includes(d)) continue
    const list = others.get(d.file) ?? []
    list.push(d)
    others.set(d.file, list)
  }
  const items: StatusItem[] = []
  if (own.length)
    items.push({
      id: 'code',
      tone: 'danger',
      title: "Code can't be generated",
      count: problems(own.length),
      rows: own.map((d) => ({ ...shortDiagnostic(d), action: ACTION.openContract })),
    })
  for (const [file, list] of others)
    items.push({
      id: `blocked:${file}`,
      tone: 'danger',
      title: `Blocked by ${basename(file)}`,
      detail: `That file has ${problems(list.length)}.`,
      rows: list.map((d) => shortDiagnostic(d)),
    })
  return items
}

/** The Code tab's own request failed, or named a component the server refused. */
export function requestItem(f: Failure | { status: 404 }): StatusItem {
  if ('status' in f)
    return {
      id: 'request',
      tone: 'danger',
      title: "Can't render this component",
      detail: "Its name has characters code can't use.",
    }
  const detail =
    transportDetail(f.code) ?? FILE_DETAIL[f.code] ?? (firstSentence(f.raw) || undefined)
  const path = pathIn(f.raw)
  return {
    id: 'request',
    tone: 'danger',
    title: "Couldn't render code",
    ...(detail ? { detail } : {}),
    ...(path ? { path, pathTitle: path } : {}),
    actions: [ACTION.retryCode],
    ...(detail !== f.raw ? { raw: f.raw } : {}),
  }
}

/** A file the server read for a render, by class; the errno text stays behind Details. */
const FILE_DETAIL: Partial<Record<Failure['code'], string>> = {
  'not-found': 'A file it reads is missing.',
  'no-access': "A file it reads can't be opened.",
  'is-folder': 'A file it reads is a folder.',
  'invalid-json': "A file it reads isn't valid JSON.",
}

/**
 * The last Write code run, when it did not write. Success is the footer's
 * caption, not a status: it is news, and the status line is for faults.
 */
export function writeItem(result: WriteResult | null | undefined): StatusItem | null {
  if (!result || result.kind === 'ok') return null
  if (result.kind === 'blocked') {
    const errors = result.diagnostics.filter(isError)
    const list = errors.length ? errors : result.diagnostics
    return {
      id: 'write',
      tone: 'danger',
      title: 'Nothing written',
      detail: `${problems(list.length)} ${list.length === 1 ? 'blocks' : 'block'} code generation.`,
      count: problems(list.length),
      rows: list.map((d) => shortDiagnostic(d)),
    }
  }
  const f = result.failure
  if (/"codegen"|codegen\.out/.test(f.raw))
    return {
      id: 'write',
      tone: 'danger',
      title: 'No output folder',
      detail: 'Set where generated code goes.',
      actions: [ACTION.setFolder],
    }
  const transport = transportDetail(f.code)
  if (transport)
    return {
      id: 'write',
      tone: 'danger',
      title: "Couldn't write code",
      detail: transport,
      raw: f.raw,
    }
  const path = pathIn(f.raw)
  const detail =
    f.code === 'no-access'
      ? 'Permission denied.'
      : f.code === 'not-found'
        ? 'A folder on the way is missing.'
        : f.code === 'is-folder'
          ? 'A file there is a folder.'
          : firstSentence(f.raw) || undefined
  return {
    id: 'write',
    tone: 'danger',
    title: "Can't write to the output folder",
    ...(detail ? { detail } : {}),
    ...(path ? { path, pathTitle: path } : {}),
    actions: [ACTION.changeFolder],
    ...(detail !== f.raw ? { raw: f.raw } : {}),
  }
}

/**
 * Stray part bindings or a bad part value: the Contract tab's one warning.
 * Worded like the Code tab's row for the same fault ('Unknown part “x”'),
 * and short enough to sit beside "Show" in the narrowest panel.
 */
export function contractProblemItem(n: number): StatusItem {
  return {
    id: 'contract',
    tone: 'warn',
    title: plural(n, 'unknown part binding'),
    actions: [ACTION.showParts],
  }
}

/* ------------------------------------------------------------ empty states */

export interface EmptyCopy {
  title: string
  hint: string
}

/**
 * What each tab says when it has nothing to show. `none` is nothing
 * selected, `multi` several layers, `outside` a layer in no component.
 * The multi title counts the layers: see `layersSelected`.
 */
export const EMPTY: Record<Face, Record<'none' | 'multi' | 'outside', EmptyCopy>> = {
  contract: {
    none: { title: 'No component selected', hint: 'Select a component, or a layer inside one.' },
    multi: { title: 'Several layers selected', hint: 'Select one to see its contract.' },
    outside: {
      title: 'Not in a component',
      hint: 'Only layers inside a component have a contract.',
    },
  },
  connect: {
    none: { title: 'No component selected', hint: 'Select a component to connect it to code.' },
    multi: { title: 'Several layers selected', hint: 'Select one to see its connection.' },
    outside: {
      title: 'Not in a component',
      hint: 'Only components, and the layers inside them, connect to code.',
    },
  },
  code: {
    none: {
      title: 'No component selected',
      hint: 'Select a component or an instance to see its code.',
    },
    multi: { title: 'Several layers selected', hint: 'Select one to see its code.' },
    outside: {
      title: 'Not in a component',
      hint: 'Only components and their instances become code.',
    },
  },
}

/** The multi-select title: '2 layers selected'. */
export const layersSelected = (n: number): string => `${n} layers selected`

/** An instance whose component is defined on another page. */
export function instanceEmpty(face: Face, name: string): EmptyCopy & { action: MessageAction } {
  return {
    title: `Instance of ${name}`,
    hint:
      face === 'connect'
        ? "Connect it where it's defined."
        : face === 'contract'
          ? `Its contract is declared on ${name}.`
          : `Its code is ${name}'s.`,
    action: openComponent(name),
  }
}

/** A `<Slot>` outside every component (Contract's own empty view). */
export const SLOT_OUTSIDE: EmptyCopy = {
  title: "Slot isn't in a component",
  hint: 'Make its frame a component to declare it.',
}

/** The Code tab with a component whose chosen targets produce no file. */
export const noFiles = (component: string): EmptyCopy & { action: MessageAction } => ({
  title: `No files for ${component}`,
  hint: 'The chosen targets produce none.',
  action: ACTION.chooseTargets,
})

/** The disclosures under the nothing-selected state: what each tab is for. */
export const ABOUT: Record<Face, { label: string; text: string }> = {
  contract: {
    label: 'About Contract',
    text: 'The contract is what an instance of a component can change without reaching inside: its properties, events, slots and states. Select a layer inside a component to name the part of the headless element it draws.',
  },
  connect: {
    label: 'About Connect',
    text: 'Connect ties a component to code: the headless element it implements, the names the library uses, and an existing React component to render with. Project settings name the library and where generated code goes.',
  },
  code: {
    label: 'About Code',
    text: 'Code is a live preview of the files code generation writes for a component, refreshed as you edit. Write code writes every component into the output folder.',
  },
}

/**
 * The (i) text of every section header in the three tabs. Each says what
 * the section is for and, where it writes, which file it saves to.
 */
export const INFO = {
  // Contract
  properties:
    'What an instance can change without reaching inside. Fill from library declares what the headless element exposes and the contract lacks.',
  states:
    'Turn a state on to draw it beside the others, then select it on the canvas to change its look. Boolean properties marked visual are states too.',
  styles: 'What each state and variant changes. Select one on the canvas to change its look.',
  slots:
    'Where an instance can put its own content. A Slot layer in the tree draws each one; one that is not drawn has no place yet.',
  codeBinding:
    "The headless element this component implements, and the layer that draws each of its parts. Generated code renders the element. Saved in the component's .uidx file.",
  // Connect
  element: (name: string): string =>
    `The web component that gives ${name || 'the component'} its behaviour and accessibility. Generated code renders it. Saved in ${name || 'the component'}.uidx.`,
  names:
    'Only where the library spells a name differently; empty fields keep the same name. Saved in uidx.json.',
  react: (name: string): string =>
    `Render ${name || 'the component'} with a React component your app already ships; generated code maps its props and events onto it. Saved in uidx.json.`,
  project:
    'Settings for every component: the library, how it names things, and where generated code goes. Saved in uidx.json.',
  // Code
  code: 'A live preview of what Write code produces. Write code writes every component into the output folder.',
} as const

/* ------------------------------------------------------------ shared copy */

/**
 * Sentences two tabs say about the same thing, kept here so they cannot
 * drift: the Element picker in Contract and Connect, the parts progress, the
 * Code footer.
 */
export const COPY = {
  /** An Element option the library lacks. */
  notInLibrary: (tag: string): string => `${tag} · not in library`,
  /** An Element option while the library cannot be read. */
  libraryUnavailable: (tag: string): string => `${tag} · library unavailable`,
  /** The configured tag is not in the library. */
  tagMissing: (tag: string): string => `${tag} isn't in the library.`,
  noLibrary: 'No library connected.',
  /** The lock chip in the identity row, said once for every tab. */
  readOnly: 'Read only. Reconnect to edit; you can still inspect and export.',
  /** The identity row's name for a multi-selection. */
  layers: (n: number): string => `${n} layers`,
  connectLibrary: 'Connect a component library to pick elements from a list.',
  partsPaused: 'Not checked while the library is unavailable.',
  chooseElement: 'Choose an element to see its parts.',
  noParts: (tag: string): string => `${tag} has no parts.`,
  partsBound: (bound: number, total: number): string => `${bound} of ${total} bound`,
  partsProgress: (bound: number, total: number): string => `${bound}/${total} parts bound`,
  strayPart: (name: string, part: string): string =>
    `“${name}” is bound to “${part}”, which nothing declares.`,
  notAPart: (tag: string): string => `Not a part of ${tag}. Code generation stops here.`,
  noImplements: (name: string): string => `${name} doesn't implement an element yet.`,
  notDrawn: 'Not drawn',
  needsOutput: 'Needs an output folder.',
  footnote: (name: string): string =>
    `Element and parts save to ${name || 'the component'}.uidx; names, React and project to uidx.json.`,
  // Code
  codeBlocked: 'Code appears here once the problem above is fixed.',
  noOutput: 'No output folder (codegen.out in uidx.json).',
  writeTo: (out: string): string => `All components → ${shortPath(out)}`,
  wrote: (n: number): string => `Wrote ${plural(n, 'file')}`,
  updating: 'Updating…',
  lastRendered: 'Last rendered',
} as const

/** Why Write code is disabled, or what it will do: the button's title. */
export function writeBlockedReason(state: {
  writable: boolean
  problems: number
  files: number
  out: string | null
}): string {
  if (!state.writable) return 'Reconnect to write code'
  if (state.problems > 0) return `Fix ${problems(state.problems)} to write code`
  if (!state.files) return 'Nothing to write yet'
  return `Write every component into ${state.out ?? 'the output folder'}`
}
