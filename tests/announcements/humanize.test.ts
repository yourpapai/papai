// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { LanguageModel } from 'ai'

import { humanizeChangelog, type HumanizeChangelogDeps } from '../../src/announcements/humanize.js'

const okConfig = {
  ok: true as const,
  source: 'global' as const,
  llmApiKey: 'k',
  llmBaseUrl: 'https://llm.example',
  mainModel: 'main',
  smallModel: 'small',
  embeddingModel: 'embed',
}

function deps(over: Partial<HumanizeChangelogDeps>): HumanizeChangelogDeps {
  return {
    resolveConfig: () => okConfig,
    buildModel: (): LanguageModel => 'test-model',
    generate: () => Promise.resolve({ text: 'Humanized!' }),
    ...over,
  }
}

describe('humanizeChangelog', () => {
  test('returns trimmed model text and passes raw as prompt', async () => {
    let seenPrompt = ''
    let seenSystem = ''
    const result = await humanizeChangelog(
      '### Added\n- thing',
      deps({
        generate: (opts) => {
          seenPrompt = opts.prompt
          seenSystem = opts.system
          return Promise.resolve({ text: '  ✨ New\n- Thing  ' })
        },
      }),
    )
    expect(result).toBe('✨ New\n- Thing')
    expect(seenPrompt).toContain('### Added')
    expect(seenSystem).toContain('announcement')
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
