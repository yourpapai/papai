// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  buildOpencodeConfig,
  modelRef,
  opencodeConfigEnv,
  PROPOSE_PERMISSION,
  READ_ONLY_PERMISSION,
  WRITE_PERMISSION,
} from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { parseModelRef } from '../../opencode-agent/src/sdk-contract.js'

/**
 * Design D8 — the capability profile for artefact-writing turns.
 *
 * The drafter (PLANNING under the OpenSpec rework) gains `edit` on top of the
 * read-only set, deny-by-default, with the diff guard's `outsidePrefix`
 * confining what survives staging to `openspec/changes/<name>/`. No `bash`:
 * composing artefacts is not running commands. These tests pin the profile's
 * shape and its registration in the built config.
 */

const settings: OpenAiSettings = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-5',
  provider: 'openai',
}

/**
 * The emitted config as it stood before `LLM_PROVIDER` existed, recorded from
 * the builder rather than written by hand.
 *
 * The default has to be *exactly* today or the change is not additive, and only
 * a whole-document comparison says so — asserting the fields the change touches
 * would pass while a permission profile quietly moved.
 */
const PRE_CHANGE_CONFIG =
  '{"$schema":"https://opencode.ai/config.json","provider":{"openai":{"npm":"@ai-sdk/openai-compatible","name":"OpenAI-compatible","options":{"apiKey":"sk-test","baseURL":"https://api.openai.com/v1"},"models":{"gpt-5":{"name":"gpt-5"}}}},"model":"openai/gpt-5","permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow"},"agent":{"plan":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow"}},"propose":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow","edit":"allow"}},"build":{"permission":{"*":"deny","read":"allow","grep":"allow","glob":"allow","list":"allow","todowrite":"allow","edit":"allow","bash":"allow","external_directory":"allow"}}}}'

describe('PROPOSE_PERMISSION (D8)', () => {
  it('is deny-by-default', () => {
    expect(PROPOSE_PERMISSION['*']).toBe('deny')
  })

  it('grants edit on top of the read-only set', () => {
    expect(PROPOSE_PERMISSION['edit']).toBe('allow')
    expect(PROPOSE_PERMISSION['read']).toBe('allow')
    expect(PROPOSE_PERMISSION['grep']).toBe('allow')
  })

  it('does not grant bash — composing artefacts is not running commands', () => {
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
  })

  it('is narrower than WRITE_PERMISSION (no bash, no external_directory)', () => {
    expect(WRITE_PERMISSION['bash']).toBe('allow')
    expect(WRITE_PERMISSION['external_directory']).toBe('allow')
    expect(PROPOSE_PERMISSION['bash']).toBeUndefined()
    expect(PROPOSE_PERMISSION['external_directory']).toBeUndefined()
  })
})

describe('buildOpencodeConfig · propose agent registration', () => {
  it('registers a propose agent with PROPOSE_PERMISSION', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
  })

  it('keeps plan read-only and build write-capable alongside it', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('pins the model reference the SDK and `opencode run` expect', () => {
    const config = buildOpencodeConfig(settings)
    expect(config.model).toBe(modelRef(settings))
    expect(config.provider?.[settings.provider]?.models?.[settings.model]?.name).toBe(settings.model)
  })
})

/**
 * The provider id is a **catalogue key**, and the emitted config has to key by
 * the configured one for the lookup to reach a real row.
 *
 * OpenCode merges this provider over its models.dev-derived database under this
 * id, so keying by a hardcoded `openai` while the endpoint serves something else
 * is what left every non-OpenAI model on `limit.context: 0` — with
 * auto-compaction switched off, since `isOverflow` returns `false` at zero.
 */
describe('buildOpencodeConfig · catalogue provider id', () => {
  const borrowed: OpenAiSettings = { ...settings, provider: 'anthropic', model: 'claude-sonnet-4-6' }

  it('emits `<provider>/<model>` as the reference both execution paths read', () => {
    expect(modelRef(borrowed)).toBe('anthropic/claude-sonnet-4-6')
    expect(modelRef(settings)).toBe('openai/gpt-5')
  })

  it('round-trips a model id that itself contains slashes', () => {
    const nested: OpenAiSettings = { ...settings, provider: 'openrouter', model: 'anthropic/claude-3.5' }

    expect(parseModelRef(modelRef(nested))).toEqual({ providerID: 'openrouter', modelID: 'anthropic/claude-3.5' })
  })

  it('keys the provider block by the configured id', () => {
    const config = buildOpencodeConfig(borrowed)

    expect(config.provider).toHaveProperty('anthropic')
    // And only that one — a leftover `openai` block would be a second row for
    // OpenCode to resolve against.
    expect(config.provider).not.toHaveProperty('openai')
    expect(config.model).toBe('anthropic/claude-sonnet-4-6')
    expect(config.provider?.['anthropic']?.models?.['claude-sonnet-4-6']?.name).toBe('claude-sonnet-4-6')
  })

  it('keeps the transport and the endpoint, whatever row is borrowed', () => {
    // The npm package is pinned ahead of the borrowed row's own in OpenCode's
    // resolution order, so this stays an OpenAI-compatible request through the
    // proxy — borrowing metadata must never mean loading another SDK package.
    const provider = buildOpencodeConfig(borrowed).provider?.['anthropic']

    expect(provider?.npm).toBe('@ai-sdk/openai-compatible')
    expect(provider?.options?.apiKey).toBe(borrowed.apiKey)
    expect(provider?.options?.baseURL).toBe(borrowed.baseUrl)
  })

  it('leaves the three permission profiles untouched by the id', () => {
    const config = buildOpencodeConfig(borrowed)

    expect(config.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['plan']?.permission).toEqual(READ_ONLY_PERMISSION)
    expect(config.agent?.['propose']?.permission).toEqual(PROPOSE_PERMISSION)
    expect(config.agent?.['build']?.permission).toEqual(WRITE_PERMISSION)
  })

  it('is byte-identical to the pre-change config when the id is the default', () => {
    // D2 — an unset `LLM_PROVIDER` must not move anything, so this pins the
    // whole emitted document rather than the fields the change touches.
    expect(JSON.stringify(buildOpencodeConfig(settings))).toBe(PRE_CHANGE_CONFIG)
  })
})

/**
 * The splice: resolved facts ride on the model entry, which is the only place
 * OpenCode reads them from.
 */
describe('buildOpencodeConfig · model facts', () => {
  const modelEntry = (s: OpenAiSettings): Record<string, unknown> | undefined =>
    buildOpencodeConfig(s).provider?.[s.provider]?.models?.[s.model]

  it('carries the resolved limit and capabilities onto the model entry', () => {
    const entry = modelEntry({
      ...settings,
      facts: { limit: { context: 200_000, output: 64_000 }, reasoning: true, tool_call: true },
    })

    expect(entry).toEqual({
      name: 'gpt-5',
      limit: { context: 200_000, output: 64_000 },
      reasoning: true,
      tool_call: true,
    })
  })

  it('emits nothing but the name when nothing was resolved', () => {
    // Not `limit: { context: 0 }`: a written zero pins the value that makes
    // `isOverflow` return `false`, where an absent key leaves OpenCode's own
    // catalogue merge free to answer.
    expect(modelEntry({ ...settings, facts: {} })).toEqual({ name: 'gpt-5' })
    expect(modelEntry(settings)).toEqual({ name: 'gpt-5' })
  })

  it('reaches the subprocess config too, so both execution paths agree', () => {
    const withFacts: OpenAiSettings = { ...settings, facts: { limit: { context: 128_000, output: 8_192 } } }
    const inlined = opencodeConfigEnv(withFacts)['OPENCODE_CONFIG_CONTENT']

    expect(inlined).toBe(JSON.stringify(buildOpencodeConfig(withFacts)))
  })

  it('leaves the default config byte-identical when no facts are resolved', () => {
    expect(JSON.stringify(buildOpencodeConfig({ ...settings, facts: {} }))).toBe(PRE_CHANGE_CONFIG)
  })
})
