// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import type { LanguageModel } from 'ai'

import {
  classifiedEntriesSchema,
  humanizeChangelog,
  type HumanizeChangelogDeps,
} from '../../src/announcements/humanize.js'
import { t } from '../../src/i18n/index.js'
import { logger, logMultistream } from '../../src/logger.js'
import { setupTestDb, waitFor } from '../utils/test-helpers.js'

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

const noneMetadata = {
  providerId: null,
  modelId: null,
  contextWindow: null,
  maxOutputTokens: null,
  source: 'none' as const,
  via: null,
}

const role = (
  model: string,
): {
  apiKey: string
  baseUrl: string
  model: string
  source: 'global'
  metadata: typeof noneMetadata
} => ({
  apiKey: 'k',
  baseUrl: 'https://llm.example',
  model,
  source: 'global',
  metadata: noneMetadata,
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
    locales: ['en'],
    ...over,
  }
}

/** Write-pass stub keyed on the ru system prompt (module scope: no conditional inside a test body). */
const localeAwareGenerate =
  (ru: () => Promise<{ text: string }>, en: () => Promise<{ text: string }>) =>
  (opts: { system: string }): Promise<{ text: string }> =>
    opts.system.includes('Russian') ? ru() : en()

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
    const writePrompts: string[] = []
    const seenModel: { apiKey?: string; baseUrl?: string; model?: string; metadata?: unknown } = {}
    const result = await humanizeChangelog(
      '### Added\n- thing',
      deps({
        buildModel: (apiKey, baseUrl, model, metadata) => {
          seenModel.apiKey = apiKey
          seenModel.baseUrl = baseUrl
          seenModel.model = model
          seenModel.metadata = metadata
          return 'test-model'
        },
        generateStructured: (opts) => {
          classifyPrompt = opts.prompt
          return Promise.resolve(twoEntries)
        },
        generate: (opts) => {
          writePrompts.push(opts.prompt)
          return Promise.resolve({ text: '  ✨ New\n- Thing  ' })
        },
      }),
    )
    expect(result).toEqual({ en: '✨ New\n- Thing' })
    expect(classifyPrompt).toContain('### Added')
    expect(writePrompts).toHaveLength(1)
    expect(writePrompts[0]).not.toContain('### Added')
    expect(writePrompts[0]).toContain('stale memory results')
    expect(seenModel).toEqual({
      apiKey: 'k',
      baseUrl: 'https://llm.example',
      model: 'main',
      metadata: noneMetadata,
    })
  })

  test('one classify pass serves one write pass per supported locale by default', async () => {
    let classifyCalls = 0
    let writeCalls = 0
    const result = await humanizeChangelog(
      'raw',
      deps({
        locales: undefined,
        generateStructured: () => {
          classifyCalls++
          return Promise.resolve(twoEntries)
        },
        generate: () => {
          writeCalls++
          return Promise.resolve({ text: 'ok' })
        },
      }),
    )
    expect(classifyCalls).toBe(1)
    expect(writeCalls).toBe(2)
    expect(result).toEqual({ en: 'ok', ru: 'ok' })
  })

  test("a pending write pass in one invocation doesn't gate another invocation (no module-level queue)", async () => {
    const aWriteStarted = Promise.withResolvers<undefined>()
    const aGate = Promise.withResolvers<{ text: string }>()
    const a = humanizeChangelog(
      'raw',
      deps({
        locales: ['en', 'ru'],
        generate: () => {
          aWriteStarted.resolve(undefined)
          return aGate.promise
        },
      }),
    )
    await aWriteStarted.promise
    let bWriteCalled = false
    const b = humanizeChangelog(
      'raw',
      deps({
        generate: () => {
          bWriteCalled = true
          return Promise.resolve({ text: 'B body' })
        },
      }),
    )
    try {
      await waitFor(() => bWriteCalled)
    } finally {
      aGate.resolve({ text: 'A body' })
    }
    expect(await a).toEqual({ en: 'A body', ru: 'A body' })
    expect(await b).toEqual({ en: 'B body' })
  })

  test('a failing locale write is isolated: the other locale still lands, with a warn naming the locale', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        locales: ['en', 'ru'],
        generate: localeAwareGenerate(
          () => Promise.reject(new Error('ru boom')),
          () => Promise.resolve({ text: 'EN body' }),
        ),
      }),
    )
    expect(result).toEqual({ en: 'EN body' })
    const ruWarns = warnEntries().filter((entry) => entry['locale'] === 'ru')
    expect(ruWarns).toHaveLength(1)
    expect(ruWarns[0]?.['error']).toBe('ru boom')
    expect(ruWarns[0]?.['msg']).toBe('Changelog humanization failed for locale')
  })

  test('returns the localized empty-release note per locale when nothing survives classification', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({ locales: ['en', 'ru'], generateStructured: () => Promise.resolve({ entries: [] }) }),
    )
    expect(result).toEqual({
      en: t('announcements.emptyReleaseNote', 'en'),
      ru: t('announcements.emptyReleaseNote', 'ru'),
    })
  })

  test('the en empty-release note keeps its literal pre-i18n text', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.resolve({ entries: [] }) }))
    expect(result.en).toBe('This release is all behind-the-scenes improvements — nothing new to learn.')
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

  test('returns an empty map when the classify pass throws', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.reject(new Error('boom')) }))
    expect(result).toEqual({})
  })

  test('returns an empty map when LLM config is missing', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        resolveConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['main_model'] }),
      }),
    )
    expect(result).toEqual({})
  })

  test('returns an empty map when every write pass throws', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        locales: ['en', 'ru'],
        generate: () => Promise.reject(new Error('boom')),
      }),
    )
    expect(result).toEqual({})
  })

  test('a whitespace-only locale write is omitted with a warn naming the locale', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        locales: ['en', 'ru'],
        generate: localeAwareGenerate(
          () => Promise.resolve({ text: '   ' }),
          () => Promise.resolve({ text: 'EN body' }),
        ),
      }),
    )
    expect(result).toEqual({ en: 'EN body' })
    const ruWarns = warnEntries().filter((entry) => entry['locale'] === 'ru')
    expect(ruWarns).toHaveLength(1)
    expect(ruWarns[0]?.['msg']).toBe('Changelog humanization returned empty output for locale')
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

  test('passes the exact write system prompt to the en announcement pass', async () => {
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

  test('ru write prompt instructs Russian output and localized section headers', async () => {
    const systems: string[] = []
    await humanizeChangelog(
      'raw',
      deps({
        locales: ['en', 'ru'],
        generate: (opts) => {
          systems.push(opts.system)
          return Promise.resolve({ text: 'ok' })
        },
      }),
    )
    const ruSystem = systems.find((system) => system.includes('Russian'))
    expect(ruSystem).toBeDefined()
    expect(ruSystem).toContain('Write the announcement in Russian.')
    expect(ruSystem).toContain('"✨ Новое"')
    expect(ruSystem).toContain('"⚡ Улучшения"')
    expect(ruSystem).toContain('"🛠 Исправления"')
  })

  test('passes the exact write system prompt to the ru announcement pass', async () => {
    let capturedSystem = ''
    await humanizeChangelog(
      'raw',
      deps({
        locales: ['ru'],
        generate: (opts) => {
          capturedSystem = opts.system
          return Promise.resolve({ text: 'ok' })
        },
      }),
    )
    expect(capturedSystem).toBe(
      'You turn a filtered list of changelog entries (a JSON array of {kind, text}) into a short, friendly release announcement for end users of a chat bot.\nWrite the announcement in Russian.\nRules:\n- Write for non-technical users. Plain, warm, concise.\n- No jargon, config keys, module names, commit hashes, or scopes in parentheses.\n- Each item is one short line framed as a benefit: what the user can now do, or what annoyance is gone.\n- Group into sections with these exact headers when content exists: "✨ Новое", "⚡ Улучшения", "🛠 Исправления". Omit a section entirely if it has no items.\n- Output only the announcement body. No preamble, no "here is", no version number.\nExample input:\n[{"kind":"new","text":"feat(telegram): pick up edited messages and update the task"},{"kind":"improvement","text":"perf: task list loads faster for large projects"},{"kind":"fix","text":"fix(memory): recall search returns stale results after compaction"}]\nExample output:\n✨ Новое\n- Передумали? Отредактируйте сообщение — и бот обновит задачу.\n\n⚡ Улучшения\n- Списки задач открываются быстрее, даже в больших проектах.\n\n🛠 Исправления\n- Поиск по памяти бота снова всегда показывает свежие результаты.',
    )
  })

  test('logs the not-configured warning with the child scope, exact metadata, and message', async () => {
    const result = await humanizeChangelog(
      'raw',
      deps({
        resolveConfig: () => ({ ok: false, type: 'missing', source: 'global', missing: ['main_model'] }),
      }),
    )
    expect(result).toEqual({})
    const warn = soleWarn()
    expect(warn['scope']).toBe('announcements:humanize')
    expect(warn['msg']).toBe('Central LLM not configured; skipping changelog humanization')
    expect(warn['type']).toBe('missing')
    expect(warn['source']).toBe('global')
    expect(warn['missing']).toEqual(['main_model'])
  })

  test('logs the humanization-failed warning with the child scope, error, and message', async () => {
    const result = await humanizeChangelog('raw', deps({ generateStructured: () => Promise.reject(new Error('boom')) }))
    expect(result).toEqual({})
    const warn = soleWarn()
    expect(warn['scope']).toBe('announcements:humanize')
    expect(warn['error']).toBe('boom')
    expect(warn['msg']).toBe('Changelog humanization failed')
  })

  test('uses the real default-deps wiring when none are passed', async () => {
    const result = await humanizeChangelog('raw')
    expect(result).toEqual({})
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
