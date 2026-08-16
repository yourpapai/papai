// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Logger } from '../../opencode-agent/src/logger.js'
import { resolveModelFacts } from '../../opencode-agent/src/model-metadata.js'
import { NO_MODEL_OVERRIDES } from '../../opencode-agent/src/openai-config.js'
import type { ModelOverrides, OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { ModelsDevDbSchema } from '../../sdd-runner/src/pricing.js'
import type { ModelsDevDb } from '../../sdd-runner/src/pricing.js'

const DB: ModelsDevDb = ModelsDevDbSchema.parse({
  anthropic: {
    models: {
      'claude-sonnet-4-6': {
        limit: { context: 200_000, output: 64_000 },
        reasoning: true,
        tool_call: true,
        temperature: true,
        attachment: true,
      },
    },
  },
})

const settingsFor = (model: string, overrides: ModelOverrides = NO_MODEL_OVERRIDES): OpenAiSettings => ({
  apiKey: 'sk-test',
  baseUrl: 'https://gateway.test/v1',
  model,
  provider: 'anthropic',
  overrides,
})

interface Captured {
  log: Logger
  debugs: Array<{ meta: unknown; message: string }>
  warns: Array<{ meta: unknown; message: string }>
}

const capture = (): Captured => {
  const debugs: Captured['debugs'] = []
  const warns: Captured['warns'] = []
  return {
    debugs,
    warns,
    log: {
      debug: (meta: unknown, message: string): void => void debugs.push({ meta, message }),
      info: (): void => {},
      warn: (meta: unknown, message: string): void => void warns.push({ meta, message }),
      error: (): void => {},
    },
  }
}

const loadDb = (db: ModelsDevDb) => (): Promise<ModelsDevDb> => Promise.resolve(db)

/**
 * D3 — most explicit tier first, and an unresolved fact omitted rather than
 * zeroed.
 *
 * The bottom rung is the whole point: `limit: { context: 0 }` written explicitly
 * would *pin* the value that makes `isOverflow` return `false`, where an absent
 * key leaves OpenCode's own catalogue merge free to answer.
 */
describe('resolveModelFacts · precedence', () => {
  test('an override wins over a catalogue hit', async () => {
    const overrides: ModelOverrides = { context: 32_000, output: 4_096, reasoning: false }

    const { facts, source } = await resolveModelFacts(settingsFor('claude-sonnet-4-6', overrides), capture().log, {
      loadDb: loadDb(DB),
    })

    expect(facts.limit).toEqual({ context: 32_000, output: 4_096 })
    expect(facts.reasoning).toBe(false)
    expect(source).toBe('override')
  })

  test('a catalogue hit answers when nothing is overridden', async () => {
    const { facts, source } = await resolveModelFacts(settingsFor('claude-sonnet-4-6'), capture().log, {
      loadDb: loadDb(DB),
    })

    expect(facts).toEqual({
      limit: { context: 200_000, output: 64_000 },
      reasoning: true,
      tool_call: true,
      temperature: true,
      attachment: true,
    })
    expect(source).toBe('catalogue')
  })

  test('the two tiers mix per field', async () => {
    const overrides: ModelOverrides = { context: 128_000, output: null, reasoning: null }

    const { facts } = await resolveModelFacts(settingsFor('claude-sonnet-4-6', overrides), capture().log, {
      loadDb: loadDb(DB),
    })

    // Context from the operator, output and reasoning still from the row.
    expect(facts.limit).toEqual({ context: 128_000, output: 64_000 })
    expect(facts.reasoning).toBe(true)
  })

  test('a miss emits nothing at all, leaving OpenCode’s own merge free to answer', async () => {
    const { facts, source } = await resolveModelFacts(settingsFor('qwen3-coder-local'), capture().log, {
      loadDb: loadDb(DB),
    })

    expect(facts).toEqual({})
    expect(source).toBe('none')
  })

  test('an override alone is enough on a total miss, with output left unstated', async () => {
    const overrides: ModelOverrides = { context: 65_536, output: null, reasoning: true }

    const { facts, source } = await resolveModelFacts(settingsFor('qwen3-coder-local', overrides), capture().log, {
      loadDb: loadDb(DB),
    })

    // `0` here is not a guess: OpenCode reads it exactly as absent, and
    // `maxOutputTokens` falls back to its own ceiling. A `0` *context* would not
    // be, which is why `limit` is keyed on context.
    expect(facts).toEqual({ limit: { context: 65_536, output: 0 }, reasoning: true })
    expect(source).toBe('override')
  })
})

/**
 * D4 — best-effort, and loud. A catalogue this run could not read must cost the
 * run nothing but a warning; it is decoration on a config that was already being
 * emitted before this module existed.
 */
describe('resolveModelFacts · degradation', () => {
  test.each([
    ['a rejecting reader', (): Promise<ModelsDevDb> => Promise.reject(new Error('ENOTFOUND models.dev'))],
    [
      'a reader that throws synchronously',
      (): Promise<ModelsDevDb> => {
        throw new Error('boom')
      },
    ],
    [
      'an empty database, which is what an unreachable host degrades to',
      (): Promise<ModelsDevDb> => Promise.resolve({}),
    ],
  ])('degrades to no facts on %s, and warns', async (_case, failing) => {
    const captured = capture()

    const { facts, source } = await resolveModelFacts(settingsFor('claude-sonnet-4-6'), captured.log, {
      loadDb: failing,
    })

    expect(facts).toEqual({})
    expect(source).toBe('none')
    expect(captured.warns).toHaveLength(1)
  })

  test('an override still answers when the catalogue cannot be read', async () => {
    const overrides: ModelOverrides = { context: 128_000, output: null, reasoning: null }

    const { facts } = await resolveModelFacts(settingsFor('claude-sonnet-4-6', overrides), capture().log, {
      loadDb: () => Promise.reject(new Error('offline')),
    })

    expect(facts.limit).toEqual({ context: 128_000, output: 0 })
  })

  test('settings with no overrides block behave as if nothing were declared', async () => {
    const bare: OpenAiSettings = {
      apiKey: 'k',
      baseUrl: 'https://x.test/v1',
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
    }

    const { source } = await resolveModelFacts(bare, capture().log, { loadDb: loadDb(DB) })

    expect(source).toBe('catalogue')
  })
})

/**
 * The line that answers "why did this run never compact" without a rerun — and
 * that must never carry the credential, since a CI log is world-readable on a
 * public repository.
 */
describe('resolveModelFacts · reporting', () => {
  test('names the model, the context window and the tier that supplied it', async () => {
    const captured = capture()

    await resolveModelFacts(settingsFor('claude-sonnet-4-6'), captured.log, { loadDb: loadDb(DB) })

    expect(captured.debugs).toContainEqual({
      meta: { model: 'anthropic/claude-sonnet-4-6', context: 200_000, reasoning: true, source: 'catalogue' },
      message: 'Resolved model facts',
    })
  })

  test('reports a total miss as nulls rather than staying silent', async () => {
    const captured = capture()

    await resolveModelFacts(settingsFor('qwen3-coder-local'), captured.log, { loadDb: loadDb(DB) })

    expect(captured.debugs[0]?.meta).toEqual({
      model: 'anthropic/qwen3-coder-local',
      context: null,
      reasoning: null,
      source: 'none',
    })
  })

  test('never logs the key or the endpoint', async () => {
    const captured = capture()

    await resolveModelFacts(settingsFor('claude-sonnet-4-6'), captured.log, { loadDb: loadDb(DB) })

    const printed = JSON.stringify([...captured.debugs, ...captured.warns])
    expect(printed).not.toContain('sk-test')
    expect(printed).not.toContain('gateway.test')
  })
})
