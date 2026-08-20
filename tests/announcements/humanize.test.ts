// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { LanguageModel } from 'ai'

import {
  classifiedEntriesSchema,
  EMPTY_RELEASE_NOTE,
  humanizeChangelog,
  type HumanizeChangelogDeps,
} from '../../src/announcements/humanize.js'
import { logger, logMultistream } from '../../src/logger.js'
import { setupTestDb } from '../utils/test-helpers.js'

// humanize.ts captures `logger.child({ scope })` once at module load, and the
// global `tests/setup.ts` preload pins LOG_LEVEL=silent before that load, so the
// child logger emits nothing by default. The logger is the real pino instance
// (preloaded transitively via tests/mock-reset.ts -> src/announcements.ts), so a
// per-file mock.module cannot replace it. Instead, attach a trace-level capture
// stream through the public `logMultistream.add()` extension point and raise the
// root logger level per-test (pino children inherit it dynamically). The level
// is restored in afterEach so the mutation never leaks past this file: the serial
// build gate (`CI=true bun check:full`) runs every file in one process.
const captured: string[] = []
logMultistream.add({
  level: 'trace',
  stream: {
    write(raw: string): void {
      captured.push(raw)
    },
  },
})
const originalLevel = logger.level

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const logEntries = (): Record<string, unknown>[] =>
  captured.flatMap((line) => {
    try {
      const entry: unknown = JSON.parse(line)
      return isRecord(entry) ? [entry] : []
    } catch {
      return []
    }
  })

const warnEntries = (): Record<string, unknown>[] => logEntries().filter((entry) => entry['level'] === 40)

const soleWarn = (): Record<string, unknown> => {
  const warns = warnEntries()
  expect(warns).toHaveLength(1)
  const warn = warns[0]
  if (warn === undefined) throw new Error('expected exactly one warn entry')
  return warn
}

const role = (model: string): { apiKey: string; baseUrl: string; model: string; source: 'global' } => ({
  apiKey: 'k',
  baseUrl: 'https://llm.example',
  model,
  source: 'global',
})

const okConfig = {
  ok: true as const,
  source: 'global' as const,
  main: role('main'),
  small: role('small'),
  embedding: role('embed'),
}

const twoEntries = {
  entries: [
    { kind: 'new' as const, text: 'feat: edit a message to update the task' },
    { kind: 'fix' as const, text: 'fix: stale memory results' },
  ],
}

function deps(over: Partial<HumanizeChangelogDeps>): HumanizeChangelogDeps {
  return {
    resolveConfig: () => okConfig,
    buildModel: (): LanguageModel => 'test-model',
    generate: () => Promise.resolve({ text: 'Humanized!' }),
    generateStructured: () => Promise.resolve(twoEntries),
    ...over,
  }
}

beforeEach(async () => {
  await setupTestDb()
  logger.level = 'trace'
  captured.length = 0
})

afterEach(() => {
  logger.level = originalLevel
})

describe('humanizeChangelog', () => {
  test('classifies first, then writes from surviving entries only', async () => {
    let classifyPrompt = ''
    let writePrompt = ''
    const seenModel: { apiKey?: string; baseUrl?: string; model?: string } = {}
    const result = await humanizeChangelog(
      '### Added\n- thing',
      deps({
        buildModel: (apiKey, baseUrl, model) => {
          seenModel.apiKey = apiKey
          seenModel.baseUrl = baseUrl
          seenModel.model = model
          return 'test-model'
        },
        generateStructured: (opts) => {
          classifyPrompt = opts.prompt
          return Promise.resolve(twoEntries)
        },
        generate: (opts) => {
          writePrompt = opts.prompt
          return Promise.resolve({ text: '  ✨ New\n- Thing  ' })
        },
      }),
    )
    expect(result).toBe('✨ New\n- Thing')
    expect(classifyPrompt).toContain('### Added')
    expect(writePrompt).not.toContain('### Added')
    expect(writePrompt).toContain('stale memory results')
    expect(seenModel).toEqual({ apiKey: 'k', baseUrl: 'https://llm.example', model: 'main' })
  })

  test('returns the empty-release note when nothing survives classification', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.resolve({ entries: [] }) }))
    expect(result).toBe(EMPTY_RELEASE_NOTE)
  })

  test('does not call the write pass when nothing survives', async () => {
    let writeCalled = false
    await humanizeChangelog(
      'raw',
      deps({
        generateStructured: () => Promise.resolve({ entries: [] }),
        generate: () => {
          writeCalled = true
          return Promise.resolve({ text: 'x' })
        },
      }),
    )
    expect(writeCalled).toBe(false)
  })

  test('returns null when the classify pass throws', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.reject(new Error('boom')) }))
    expect(result).toBeNull()
  })

  test('returns null when LLM config is missing', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        resolveConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['main_model'] }),
      }),
    )
    expect(result).toBeNull()
  })

  test('returns null when the model throws', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        generate: () => Promise.reject(new Error('boom')),
      }),
    )
    expect(result).toBeNull()
  })

  test('returns null when the model returns only whitespace', async () => {
    const result = await humanizeChangelog('raw', deps({ generate: () => Promise.resolve({ text: '   ' }) }))
    expect(result).toBeNull()
  })

  test('write prompt demands plain benefit framing and the three sections', async () => {
    let writeSystem = ''
    await humanizeChangelog(
      'raw',
      deps({
        generate: (opts) => {
          writeSystem = opts.system
          return Promise.resolve({ text: 'ok' })
        },
      }),
    )
    expect(writeSystem).toContain('⚡ Improvements')
    expect(writeSystem).toContain('Example input')
    expect(writeSystem).toContain('benefit')
  })

  test('passes the exact classify system prompt to the structured pass', async () => {
    let capturedSystem = ''
    await humanizeChangelog(
      'raw',
      deps({
        generateStructured: (opts) => {
          capturedSystem = opts.system
          return Promise.resolve(twoEntries)
        },
      }),
    )
    expect(capturedSystem).toBe(
      'You select which software changelog entries matter to end users of a chat bot.\nRules:\n- Keep only changes a non-technical user would notice or benefit from: new capabilities, improvements to speed, reliability or usability, and bug fixes.\n- Drop internal changes: build, ci, test, chore, refactor, deps, docs, formatting, and other internal plumbing.\n- When in doubt, drop the entry.\n- For each kept entry set kind: "new" for a new capability, "improvement" when something works better or faster now, "fix" when a problem is gone.\n- Keep "text" close to the original entry. Do not rewrite for tone; that happens later.',
    )
  })

  test('passes the exact write system prompt to the announcement pass', async () => {
    let capturedSystem = ''
    await humanizeChangelog(
      'raw',
      deps({
        generate: (opts) => {
          capturedSystem = opts.system
          return Promise.resolve({ text: 'ok' })
        },
      }),
    )
    expect(capturedSystem).toBe(
      'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.\nRules:\n- Write for non-technical users. Plain, warm, concise.\n- No jargon, config keys, module names, commit hashes, or scopes in parentheses.\n- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.\n- Group into sections with these exact headers when content exists: "✨ New", "⚡ Improvements", "🛠 Fixes". Omit a section entirely if it has no items.\n- Output only the announcement body. No preamble, no "here is", no version number.\nExample input:\n[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"improvement","text":"perf: task list loads faster for large projects"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]\nExample output:\n✨ New\n- Changed your mind? Edit your message and the bot updates the task.\n\n⚡ Improvements\n- Your task lists open faster, even in big projects.\n\n🛠 Fixes\n- The bot\'s memory search always shows fresh results again.',
    )
  })

  test('returns the literal empty-release note text when nothing survives', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.resolve({ entries: [] }) }))
    expect(result).toBe('This release is all behind-the-scenes improvements — nothing new to learn.')
  })

  test('logs the not-configured warning with the child scope, exact metadata, and message', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        resolveConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['main_model'] }),
      }),
    )
    expect(result).toBeNull()
    const warn = soleWarn()
    expect(warn['scope']).toBe('announcements:humanize')
    expect(warn['msg']).toBe('Central LLM not configured; skipping changelog humanization')
    expect(warn['type']).toBe('missing')
    expect(warn['source']).toBe('global')
    expect(warn['missing']).toEqual(['main_model'])
  })

  test('logs the humanization-failed warning with the child scope, error, and message', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.reject(new Error('boom')) }))
    expect(result).toBeNull()
    const warn = soleWarn()
    expect(warn['scope']).toBe('announcements:humanize')
    expect(warn['error']).toBe('boom')
    expect(warn['msg']).toBe('Changelog humanization failed')
  })

  test('uses the real default-deps wiring when none are passed', async () => {
    const result = await humanizeChangelog('raw')
    expect(result).toBeNull()
  })
})

describe('classifiedEntriesSchema', () => {
  test('accepts new, improvement, and fix kinds', () => {
    const result = classifiedEntriesSchema.safeParse({
      entries: [
        { kind: 'new', text: 'a' },
        { kind: 'improvement', text: 'b' },
        { kind: 'fix', text: 'c' },
      ],
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown kinds', () => {
    const result = classifiedEntriesSchema.safeParse({ entries: [{ kind: 'chore', text: 'x' }] })
    expect(result.success).toBe(false)
  })
})
