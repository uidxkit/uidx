import { describe, expect, it } from 'vitest'

import {
  ABOUT,
  EMPTY,
  COPY,
  INFO,
  classifyFailure,
  codeItems,
  configLoadItem,
  contractProblemItem,
  fieldErrorText,
  firstSentence,
  libraryChoiceText,
  libraryItem,
  noFiles,
  plainText,
  requestItem,
  shortDiagnostic,
  shortPath,
  slotFill,
  sortByTone,
  writeBlockedReason,
  writeItem,
  type Diagnostic,
  type StatusItem,
} from '../src/inspector-messages'

const ENOENT =
  "Could not read the headless library: ENOENT: no such file or directory, open '/abs/vendor/hwc/missing/custom-elements.json'"

const diag = (file: string, line: number, message: string, severity = 'error'): Diagnostic => ({
  file,
  line,
  column: 1,
  message,
  severity,
})

/** The tabs' words: one module, so a fault reads the same on every tab. */
describe('classifyFailure', () => {
  it('reads the class from the raw server and transport messages', () => {
    expect(classifyFailure(new Error(ENOENT)).code).toBe('not-found')
    expect(classifyFailure(new Error("EACCES: permission denied, open '/x.json'")).code).toBe(
      'no-access',
    )
    expect(classifyFailure(new Error('EISDIR: illegal operation on a directory, read')).code).toBe(
      'is-folder',
    )
    expect(
      classifyFailure(
        new Error(
          'Could not read the headless library: Unexpected token } in JSON at position 48213',
        ),
      ).code,
    ).toBe('invalid-json')
    expect(classifyFailure(new DOMException('signal timed out', 'TimeoutError')).code).toBe(
      'timeout',
    )
    expect(classifyFailure(new TypeError('Failed to fetch')).code).toBe('network')
    expect(classifyFailure(new Error('The headless library service is unavailable.')).code).toBe(
      'unavailable',
    )
    expect(classifyFailure('something else').code).toBe('unknown')
  })

  it('prefers the code the server sends, and keeps the raw text', () => {
    const error = Object.assign(new Error('Could not read the headless library: weird'), {
      code: 'EACCES',
    })
    expect(classifyFailure(error)).toEqual({
      code: 'no-access',
      raw: 'Could not read the headless library: weird',
    })
    expect(classifyFailure(Object.assign(new Error('x'), { code: 'EJSON' })).code).toBe(
      'invalid-json',
    )
  })

  it('takes an HTML page where JSON was expected for the server, not the file', () => {
    expect(
      classifyFailure(new SyntaxError(`Unexpected token '<', "<html><bod"... is not valid JSON`))
        .code,
    ).toBe('unavailable')
  })
})

describe('shortPath and firstSentence', () => {
  it('keeps the first named segment and the file, joined by an ellipsis', () => {
    expect(shortPath('../vendor/hwc/missing/custom-elements.json')).toBe(
      '../vendor/…/custom-elements.json',
    )
    expect(shortPath('src/ds')).toBe('src/ds')
    expect(shortPath('/home/user/projects/acme/packages/generated/react')).toBe(
      '/home/…/packages/generated/react',
    )
  })

  it('keeps the file name within a tighter budget, and with nothing in between to drop', () => {
    // The status chip's budget: the head goes before the file name is cut.
    expect(shortPath('../vendor/hwc/missing/custom-elements.json', 28)).toBe(
      '…/custom-elements.json',
    )
    expect(shortPath('../a-very-long-output-folder-name/generated')).toBe('…/generated')
  })

  it('cuts a description at its first sentence, without Markdown', () => {
    expect(
      firstSentence(
        'Buttons represent *actions* that are `available` to the [user](https://x.dev). They can be styled.',
      ),
    ).toBe('Buttons represent actions that are available to the user.')
    expect(firstSentence('No full stop')).toBe('No full stop')
  })
})

describe('the library item', () => {
  const missing = classifyFailure(new Error(ENOENT))

  it('has the same title on every tab; the detail and actions differ', () => {
    const items = (['connect', 'contract', 'code'] as const).map((face) =>
      libraryItem(missing, face, '../vendor/hwc/missing/custom-elements.json'),
    )
    expect(new Set(items.map((item) => item.title))).toEqual(new Set(['Library file not found']))
    expect(items.map((item) => item.tone)).toEqual(['danger', 'danger', 'danger'])
    expect(items[0]!.detail).toBe('Element and part checks are paused until it loads.')
    expect(items[1]!.detail).toBe('Part checks are paused.')
    expect(items[2]!.detail).toBe("Code can't render without it.")
    expect(items[0]!.actions!.map((a) => a.label)).toEqual(['Choose library', 'Retry'])
    expect(items[1]!.actions!.map((a) => a.label)).toEqual(['Fix in Setup', 'Retry'])
    expect(items[2]!.actions).toEqual(items[1]!.actions)
    // The configured path shows; the absolute one the server tried is its title.
    expect(items[0]!.path).toBe('../vendor/hwc/missing/custom-elements.json')
    expect(items[0]!.pathTitle).toBe('/abs/vendor/hwc/missing/custom-elements.json')
    expect(items[0]!.raw).toBe(ENOENT)
  })

  it('words each class of failure, and offers only Retry for the server', () => {
    const title = (raw: string): string =>
      libraryItem(classifyFailure(new Error(raw)), 'code', null).title
    expect(title('EACCES: permission denied')).toBe("Can't open the library file")
    expect(title('EISDIR: illegal operation on a directory')).toBe('Library path is a folder')
    expect(title('Unexpected end of JSON input')).toBe("Library file isn't valid JSON")
    expect(title('signal timed out')).toBe("Server didn't respond")
    expect(title('The headless library service is unavailable.')).toBe(
      'Library service unavailable',
    )
    expect(title('Failed to fetch')).toBe("Can't reach the uidx server")
    const down = libraryItem(classifyFailure(new Error('Failed to fetch')), 'connect', 'x.json')
    expect(down.actions!.map((a) => a.run)).toEqual(['retry-library'])
    expect(down.path).toBeUndefined()
  })
})

describe('uidx.json items', () => {
  it('words a load failure', () => {
    const load = configLoadItem(classifyFailure(new Error('Failed to fetch')))
    expect(load.title).toBe("Can't reach the uidx server")
    expect(load.actions).toEqual([{ label: 'Retry', run: 'retry-config' }])
  })

  it('turns a refused field into a short line under it', () => {
    expect(fieldErrorText('react', 'Name the module the React component is imported from.')).toBe(
      'Name the module to import from',
    )
    expect(fieldErrorText('react', 'Say where generated code goes first ("Output" below).')).toBe(
      'Needs an output folder',
    )
    expect(fieldErrorText('codegen', 'Name the folder generated code goes into.')).toBe(
      'Enter a folder',
    )
  })
})

describe('code diagnostics', () => {
  const SPINNER =
    'part "spinner-track" has no element in the manifest (looked for hwc-button-spinner-track)'

  it('names an unknown part, and says where it is', () => {
    expect(shortDiagnostic(diag('button.uidx', 11, SPINNER))).toEqual({
      label: 'Unknown part “spinner-track”',
      full: `button.uidx:11 ${SPINNER}`,
      meta: 'button.uidx · line 11',
    })
    expect(
      shortDiagnostic(
        diag(
          'button.uidx',
          3,
          'part "spinner" (bound to "spinner-track") has no element in the manifest (looked for x)',
        ),
      ).label,
    ).toBe('Unknown part “spinner”')
    expect(shortDiagnostic(diag('a.uidx', 1, 'the contract is odd (see ADR 13)')).label).toBe(
      'The contract is odd',
    )
  })

  it('curls the server’s straight quotes in the label, and keeps them in the full text', () => {
    const message = 'the contract declares the event "press", which sl-button does not dispatch'
    const row = shortDiagnostic(diag('a.uidx', 1, message))
    expect(row.label).toBe(
      'The contract declares the event “press”, which sl-button does not dispatch',
    )
    expect(row.full).toBe(`a.uidx:1 ${message}`)
  })

  it("splits the subject's own problems from the files that block it", () => {
    const items = codeItems(
      [
        diag('components/button.uidx', 11, SPINNER),
        diag('components/button.uidx', 12, 'a'),
        diag('components/button.uidx', 13, 'b'),
        diag('components/button.uidx', 14, 'c'),
        diag('components/checkbox-field.uidx', 4, 'd'),
        diag('components/button.uidx', 20, 'just a warning', 'warning'),
      ],
      'button.uidx',
    )
    expect(items.map((item) => [item.id, item.title, item.count])).toEqual([
      ['code', "Can't generate code", '4 problems'],
      ['blocked:components/checkbox-field.uidx', 'Blocked by checkbox-field.uidx', undefined],
    ])
    expect(items[0]!.rows).toHaveLength(4)
    expect(items[0]!.rows![0]!.action).toEqual({
      label: 'Open Component API',
      run: 'open-contract',
    })
    expect(items[1]!.detail).toBe('That file has 1 problem.')
    expect(items[1]!.rows![0]!.action).toBeUndefined()
    expect(items[1]!.actions).toBeUndefined()
    expect(codeItems([diag('a.uidx', 1, 'w', 'warning')])).toEqual([])
  })

  it('opens the component a blocking file declares, when it is known', () => {
    const declaredIn = (file: string): string | undefined =>
      file === 'components/checkbox-field.uidx' ? 'CheckboxField' : undefined
    const [blocked, tokens] = codeItems(
      [diag('components/checkbox-field.uidx', 4, 'd'), diag('tokens.uidx', 1, 'e')],
      'button.uidx',
      declaredIn,
    )
    expect(blocked!.actions).toEqual([
      { label: 'Open CheckboxField', run: 'open-component', arg: 'CheckboxField' },
    ])
    // A file that declares no component has nothing to open.
    expect(tokens!.actions).toBeUndefined()
  })

  it('words request failures and the refused name', () => {
    expect(requestItem({ status: 404 })).toMatchObject({
      title: "Can't render this component",
      detail: "Its name has characters code can't use.",
    })
    const down = requestItem(classifyFailure(new TypeError('Failed to fetch')))
    expect(down).toMatchObject({
      title: "Couldn't render code",
      detail: "The server didn't respond.",
    })
    expect(down.actions).toEqual([{ label: 'Retry', run: 'retry-code' }])
    // A file the render reads: a short sentence, the errno text behind Details.
    const missing = requestItem(
      classifyFailure(new Error("ENOENT: no such file or directory, open '/abs/tokens.json'")),
    )
    expect(missing).toMatchObject({
      detail: 'A file it reads is missing.',
      path: '/abs/tokens.json',
    })
    expect(missing.raw).toMatch(/^ENOENT/)
  })
})

describe('the write result', () => {
  it('is quiet on success and names what stopped it otherwise', () => {
    expect(writeItem(null)).toBeNull()
    expect(writeItem({ kind: 'ok', written: 3, out: '../generated', at: 0 })).toBeNull()
    const blocked = writeItem({
      kind: 'blocked',
      diagnostics: [diag('a.uidx', 11, 'x'), diag('b.uidx', 42, 'y')],
    })!
    expect(blocked).toMatchObject({
      title: 'Nothing written',
      detail: '2 problems block code generation.',
    })
    expect(blocked.rows!.map((row) => row.meta)).toEqual(['a.uidx · line 11', 'b.uidx · line 42'])
    const denied = writeItem({
      kind: 'failed',
      failure: classifyFailure(
        new Error("EACCES: permission denied, mkdir '/home/me/app/packages/generated/react'"),
      ),
    })!
    expect(denied).toMatchObject({
      title: "Can't write to the output folder",
      detail: 'Permission denied.',
      path: '/home/me/app/packages/generated/react',
      actions: [{ label: 'Change folder', run: 'open-project', arg: 'output' }],
    })
    expect(denied.raw).toMatch(/EACCES/)
  })

  it('names the folder as uidx.json does, with the path the server tried in its title', () => {
    const denied = writeItem(
      {
        kind: 'failed',
        failure: classifyFailure(
          new Error("EACCES: permission denied, mkdir '/home/me/app/packages/generated/react'"),
        ),
      },
      '../packages/generated',
    )!
    expect(denied.path).toBe('../packages/generated')
    expect(denied.pathTitle).toBe('/home/me/app/packages/generated/react')
  })

  it('says a file is in the way when a folder on the path is a file', () => {
    const raw = "ENOTDIR: not a directory, mkdir '/abs/p1/package.json/generated/html'"
    const blocked = writeItem(
      { kind: 'failed', failure: classifyFailure(new Error(raw)) },
      '../package.json/generated',
    )!
    expect(blocked).toMatchObject({
      title: "Can't write to the output folder",
      detail: 'A file is in the way of that folder.',
      path: '../package.json/generated',
      pathTitle: '/abs/p1/package.json/generated/html',
      raw,
    })
  })
})

describe('order and copy', () => {
  it('sorts danger before warn before info, keeping order within a tone', () => {
    const item = (id: string, tone: StatusItem['tone']): StatusItem => ({ id, tone, title: id })
    expect(
      sortByTone([
        item('a', 'info'),
        item('b', 'warn'),
        item('c', 'danger'),
        item('d', 'warn'),
      ]).map((i) => i.id),
    ).toEqual(['c', 'b', 'd', 'a'])
  })

  it('words every empty state and (i) in short sentences', () => {
    for (const face of ['contract', 'connect', 'code'] as const) {
      expect(EMPTY[face].none.title).toBe('No component selected')
      expect(ABOUT[face].label).toMatch(/^About /)
    }
    expect(EMPTY.code.none.hint).toContain('Select a component')
    expect(INFO.react('Button')).toContain('uidx.json')
  })

  it('names the page a component is saved in, not a file named after it', () => {
    expect(INFO.element('ContactList', 'components/contact-list.uidx')).toContain(
      'Saved in contact-list.uidx.',
    )
    expect(INFO.element('ContactList')).toContain("Saved in ContactList's .uidx file.")
    expect(COPY.footnote('ContactList', 'components/contact-list.uidx')).toBe(
      'Element and parts save to contact-list.uidx; names, React and project to uidx.json.',
    )
    expect(COPY.footnote('')).toContain("save to the component's .uidx file;")
  })

  it('makes no claim about targets where nothing renders', () => {
    // The preview renders every kind of file whatever the targets, so they are never why.
    expect(noFiles('Badge')).toEqual({
      title: 'No code for Badge',
      hint: 'Code is generated once it implements an element or declares a property.',
    })
    expect(INFO.code).not.toMatch(/Write code.*Write code/)
    expect(ABOUT.code.text).not.toMatch(/Write code writes/)
  })

  it('says whose slot a fill fills, and opens that component', () => {
    expect(slotFill('List', 'item')).toEqual({
      title: "Fills List's item slot",
      hint: "The slot is declared on List; what is inside is this page's.",
      action: { label: 'Open List', run: 'open-component', arg: 'List' },
    })
  })

  it('says why Write code is disabled, a render that failed included', () => {
    const state = { writable: true, problems: 0, files: 0, out: '../generated' }
    expect(writeBlockedReason({ ...state, writable: false })).toBe('Reconnect to write code')
    expect(writeBlockedReason({ ...state, problems: 2 })).toBe('Fix 2 problems to write code')
    expect(writeBlockedReason({ ...state, failed: true })).toBe(
      'Fix the problem above to write code',
    )
    expect(writeBlockedReason(state)).toBe('Nothing to write yet')
    expect(writeBlockedReason({ ...state, files: 3 })).toBe(
      'Write every component into ../generated',
    )
  })

  it('words a refused library choice as the status line words a library that will not load', () => {
    const missing = classifyFailure(Object.assign(new Error('nope'), { code: 'ENOENT' }))
    expect(libraryChoiceText(missing)).toBe('Library file not found')
  })

  it('words the Contract warning like the Code row for the same fault', () => {
    expect(contractProblemItem(1).title).toBe('1 unknown part binding')
    expect(contractProblemItem(2)).toMatchObject({
      title: '2 unknown part bindings',
      tone: 'warn',
      actions: [{ label: 'Show', run: 'open-contract' }],
    })
  })

  it('strips Markdown from a whole description without cutting it', () => {
    const text = 'A `button` with a [link](https://x.dev).  Second *one* here.'
    expect(plainText(text)).toBe('A button with a link. Second one here.')
    expect(firstSentence(text)).toBe('A button with a link.')
  })
})
