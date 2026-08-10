// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import type { TranscriptRow } from '../../opencode-agent/src/activity-detail.js'
import { createDebugTranscript } from '../../opencode-agent/src/debug-transcript.js'

/**
 * The viewer, run rather than read.
 *
 * The page is the only reader of the transcript format that does not import
 * `debug-transcript.ts`, so it is the one that can drift from it silently — and
 * the drift would only show when a maintainer already has an incident and a
 * key. So this test extracts the page's own `<script>`, imports it in this
 * runtime, and decodes a transcript that the real writer produced. Bun provides
 * WebCrypto, `atob` and `TextDecoder`, which is everything the decoding half
 * touches; the DOM wiring is guarded in the page and never runs here.
 *
 * What this does *not* cover is the rendering: no test here proves the table
 * draws. That is deliberate — the format contract is what breaks unnoticed, and
 * a broken table is visible the moment anyone opens the page.
 */

const VIEWER = path.join(import.meta.dir, '..', '..', 'opencode-agent', 'viewer', 'index.html')

const workDir = await mkdtemp(path.join(tmpdir(), 'transcript-viewer-'))

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true })
})

const html = readFileSync(VIEWER, 'utf8')

/** The page's module script, as source. */
const scriptOf = (page: string): string => {
  const opened = page.indexOf('<script type="module">')
  const closed = page.indexOf('</script>', opened)
  return page.slice(page.indexOf('>', opened) + 1, closed)
}

/** What the page hands back, which is `TranscriptRow` as JSON round-trips it. */
type ViewerRow = TranscriptRow

type Decoded = { ok: true; row: ViewerRow } | { ok: false }

interface Viewer {
  parseKey: (pasted: string) => Uint8Array
  decodeLine: (key: Uint8Array, line: string) => Promise<ViewerRow>
  decodeAll: (key: Uint8Array, text: string) => Promise<Decoded[]>
  formatLine: (result: Decoded) => string
  formatLines: (results: readonly Decoded[]) => string
}

/**
 * The imported module, typed without an assertion.
 *
 * A dynamic `import()` of a runtime path is `any`, and `no-unsafe-type-assertion`
 * refuses the obvious cast — rightly, since this module is generated a few lines
 * above and a rename in the page would otherwise surface as `undefined is not a
 * function` rather than as a failed parse.
 */
const isFunction = (value: unknown): boolean => typeof value === 'function'

const viewerSchema = z.object({
  parseKey: z.custom<Viewer['parseKey']>(isFunction),
  decodeLine: z.custom<Viewer['decodeLine']>(isFunction),
  decodeAll: z.custom<Viewer['decodeAll']>(isFunction),
  formatLine: z.custom<Viewer['formatLine']>(isFunction),
  formatLines: z.custom<Viewer['formatLines']>(isFunction),
})

/**
 * The page's script as an importable module.
 *
 * The exports are appended here rather than written into the page: an inline
 * `<script type="module">` that exported things would be exporting to nobody,
 * and a browser-meaningless line in shipped source is a line that gets
 * "cleaned up" by the next person to read it.
 */
const loadViewer = async (): Promise<Viewer> => {
  const file = path.join(workDir, 'viewer.mjs')
  await writeFile(
    file,
    `${scriptOf(html)}\nexport { parseKey, decodeLine, decodeAll, formatLine, formatLines }\n`,
    'utf8',
  )
  const module: unknown = await import(file)
  return viewerSchema.parse(module)
}

const viewer = await loadViewer()

const KEY = new Uint8Array(Array.from({ length: 32 }, (_, index) => index + 1))
const KEY_B64 = Buffer.from(KEY).toString('base64')

const BASH_ROW: TranscriptRow = {
  time: '2026-08-09T12:00:00.000Z',
  tool: 'bash',
  status: 'completed',
  detail: 'bun test',
  durationMs: 3200,
}

const ROWS: TranscriptRow[] = [
  BASH_ROW,
  { time: '2026-08-09T12:00:04.000Z', tool: 'read', status: 'running', detail: 'src/retry.ts', durationMs: null },
  { time: '2026-08-09T12:00:05.000Z', tool: 'todowrite', status: 'completed', detail: null, durationMs: 12 },
]

/** A real transcript, written by the module the page has to stay in step with. */
const writeTranscript = async (name: string, secrets: readonly string[] = []): Promise<string> => {
  const file = path.join(workDir, name)
  const transcript = createDebugTranscript({ key: KEY, path: file, secrets })
  for (const row of ROWS) transcript.write(row)
  await transcript.close()
  return readFileSync(file, 'utf8')
}

/** Keeps the narrowing out of the test bodies, per repo lint. */
const rowsOf = (results: readonly Decoded[]): ViewerRow[] =>
  results.flatMap((result) => (result.ok ? [result.row] : []))

const okOf = (results: readonly Decoded[]): boolean[] => results.map((result) => result.ok)

const firstLineOf = (text: string): string => text.split('\n')[0] ?? ''

describe('the viewer decodes what the pipeline wrote', () => {
  test('reads a whole transcript, in the order the run made it', async () => {
    const text = await writeTranscript('whole.enc')

    expect(rowsOf(await viewer.decodeAll(KEY, text))).toEqual(ROWS)
  })

  test('reads one line on its own, which is what makes a truncated file readable', async () => {
    const text = await writeTranscript('one-line.enc')

    expect(await viewer.decodeLine(KEY, firstLineOf(text))).toEqual(BASH_ROW)
  })

  test('reports a truncated final line rather than losing the lines before it', async () => {
    // A runner killed mid-write is the ordinary way this artefact ends, and a
    // reader that gives up on the file is a reader that is never useful when it
    // is most needed.
    const text = await writeTranscript('truncated.enc')
    const truncated = `${text.trimEnd().slice(0, -8)}\n`

    expect(okOf(await viewer.decodeAll(KEY, truncated))).toEqual([true, true, false])
  })

  test('reports every line as unreadable under a key from another run', async () => {
    const text = await writeTranscript('wrong-key.enc')

    expect(okOf(await viewer.decodeAll(new Uint8Array(32).fill(9), text))).toEqual([false, false, false])
  })

  test('never shows a redacted credential, because it was never encrypted', async () => {
    // The redaction is the writer's, pre-encryption and by value — so the key
    // holder cannot read it back either, and this is where that is visible.
    const secret = 'ghp_0123456789abcdefghij'
    const file = path.join(workDir, 'redacted.enc')
    const transcript = createDebugTranscript({ key: KEY, path: file, secrets: [secret] })
    transcript.write({ ...BASH_ROW, detail: `git push https://x:${secret}@github.com/acme/widgets` })
    await transcript.close()

    const decoded = await viewer.decodeLine(KEY, firstLineOf(readFileSync(file, 'utf8')))
    expect(decoded.detail).toBe('git push https://x:[redacted]@github.com/acme/widgets')
  })
})

/** The two mistakes a maintainer actually makes, told apart. */
const keyErrorOf = (pasted: string): string => {
  try {
    viewer.parseKey(pasted)
    return ''
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('the key box', () => {
  test('accepts the base64 the repository secret holds', () => {
    expect(viewer.parseKey(KEY_B64)).toEqual(KEY)
  })

  test('ignores the whitespace a paste brings with it', () => {
    expect(viewer.parseKey(`  ${KEY_B64}\n`)).toEqual(KEY)
  })

  test.each([
    ['', 'AGENT_LOG_KEY'],
    ['not base64!!', 'base64'],
    [Buffer.from(new Uint8Array(16)).toString('base64'), '16 bytes'],
  ])('says what is wrong with %p rather than failing to decrypt', (pasted, expected) => {
    expect(keyErrorOf(pasted)).toContain(expected)
  })
})

/** A decoded result with any field overridden, for the formatter tests. */
const decoded = (over: Partial<ViewerRow> = {}): Decoded => ({ ok: true, row: { ...BASH_ROW, ...over } })

describe('the copy formatter', () => {
  test('renders a complete row as pipe-separated text, matching the table cells', () => {
    expect(viewer.formatLine(decoded())).toBe('2026-08-09T12:00:00.000Z | bash | completed | bun test | 3.2s')
  })

  test('leaves the detail field empty when the row carried none', () => {
    expect(viewer.formatLine(decoded({ detail: null }))).toBe('2026-08-09T12:00:00.000Z | bash | completed |  | 3.2s')
  })

  test('leaves the duration empty when the tool was still running', () => {
    expect(viewer.formatLine(decoded({ durationMs: null }))).toBe(
      '2026-08-09T12:00:00.000Z | bash | completed | bun test | ',
    )
  })

  test('marks an unreadable line the way the table draws it', () => {
    expect(viewer.formatLine({ ok: false })).toBe(
      '— | — | unreadable | This line could not be opened with this key. | ',
    )
  })

  test('formatLines adds the table header and joins every line in order', () => {
    const text = viewer.formatLines([
      decoded(),
      { ok: false },
      decoded({ tool: 'read', detail: null, durationMs: null }),
    ])
    expect(text.split('\n')).toEqual([
      'Time | Tool | Status | Detail | Took',
      '2026-08-09T12:00:00.000Z | bash | completed | bun test | 3.2s',
      '— | — | unreadable | This line could not be opened with this key. | ',
      '2026-08-09T12:00:00.000Z | read | completed |  | ',
    ])
  })
})

describe('the page is self-contained', () => {
  test('fetches nothing, so neither the key nor the artefact can leave the tab', () => {
    // The page is served from GitHub Pages and opened by someone holding a
    // decryption key. A script, stylesheet or font from a third party would be
    // code that could take the key, injected by whoever controls that origin.
    expect(html).not.toMatch(/<script[^>]+src=/iu)
    expect(html).not.toMatch(/<link[^>]+href=/iu)
    expect(html).not.toContain('fetch(')
    expect(html).not.toContain('XMLHttpRequest')
    expect(html).not.toContain('http')
  })
})
