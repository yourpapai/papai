// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LanguageModel } from 'ai'

import {
  classifiedEntriesSchema,
  EMPTY_RELEASE_NOTE,
  humanizeChangelog,
  type HumanizeChangelogDeps,
} from '../../src/announcements/humanize.js'

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
