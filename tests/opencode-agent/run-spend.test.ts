// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { Logger } from '../../opencode-agent/src/logger.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { resolveRunCost } from '../../opencode-agent/src/run-spend.js'
import { ModelsDevDbSchema } from '../../sdd-runner/src/pricing.js'
import type { ModelsDevDb } from '../../sdd-runner/src/pricing.js'
import { costOfUsage } from '../../sdd-runner/src/usage-aggregate.js'

/**
 * The ladder decides what a run cost, and the whole point of it is that
 * "unknown" is a rung rather than a zero. Every test here is really one
 * question: which rung answered, and did an unanswerable case say so.
 */

const DB: ModelsDevDb = ModelsDevDbSchema.parse({
  anthropic: {
    models: {
      'claude-sonnet-5': { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } },
      'local-llama': {},
    },
  },
  openrouter: {
    models: { 'claude-sonnet-5': { cost: { input: 3.1, output: 15.5 } } },
  },
})

const settings = (model: string, provider = 'anthropic'): OpenAiSettings => ({
  apiKey: 'sk-test',
  baseUrl: 'https://gateway.test/v1',
  model,
  provider,
})

const silent: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

const loadDb = (db: ModelsDevDb) => (): Promise<ModelsDevDb> => Promise.resolve(db)

/** One turn's counts, priced by the catalogue row above at a round figure. */
const BUCKETS = { input: 1_000_000, output: 1_000_000, reasoning: 0, cacheRead: 0, cacheWrite: 0 }

describe('resolveRunCost · the ladder', () => {
  test('the backend’s own figure wins when it is non-zero', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0.126837, buckets: BUCKETS, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: 0.126837, source: 'backend' })
  })

  test('a zero backend figure falls through to the catalogue', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: 18, source: 'catalogue' })
  })

  test('an absent backend figure falls through to the catalogue', async () => {
    const resolved = await resolveRunCost(
      { buckets: BUCKETS, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved.source).toBe('catalogue')
  })

  /**
   * The rung the whole change exists for. `types.ts` records the incident: a
   * model the catalogue does not price reports a cost of `0`, and a `0` that
   * reads as a real figure is worse than no figure at all.
   */
  test('a model no catalogue prices is unpriced, not $0.00', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('nothing-knows-this', 'self-hosted') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  test('a catalogue row carrying no price at all is unpriced', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('local-llama') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  /**
   * Fail closed — `treeSpend`'s doctrine one workspace over: absent usage makes
   * the ledger read unknown, never `$0` headroom. A cache bucket the server did
   * not report cannot be priced, and pricing the rest would under-charge a
   * cache-heavy run while looking exact.
   */
  test('a bucket the backend did not report yields unpriced, not a partial price', async () => {
    const resolved = await resolveRunCost(
      {
        backendUsd: 0,
        buckets: { input: 1_000_000, output: 1_000_000, reasoning: 0 },
        settings: settings('claude-sonnet-5'),
      },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  test('a backend figure still wins when a bucket is missing — nothing needs pricing', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0.5, buckets: { input: 1, output: 1 }, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: 0.5, source: 'backend' })
  })

  test('a run that consumed nothing and cost nothing is $0, which is a true figure', async () => {
    const resolved = await resolveRunCost(
      {
        backendUsd: 0,
        buckets: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        settings: settings('claude-sonnet-5'),
      },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: 0, source: 'catalogue' })
  })

  test('an unreachable catalogue is unpriced rather than a thrown run', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: () => Promise.reject(new Error('models.dev is down')) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  /**
   * `resolveCost` throws on a reference it cannot split into provider and model,
   * and a throw here would take the phase with it — which is the one thing this
   * module must never do. Reporting is a decoration on a run; it does not get to
   * fail one.
   */
  test('a model reference the catalogue cannot parse is unpriced, not a thrown run', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5', '') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  /**
   * The defect `claude-route-pricing-reference` closed, pinned where it was
   * observable. The claude route composed its reference from `LLM_PROVIDER`, so
   * a model spelled `provider/model` — the form that route accepts and strips
   * before invoking the CLI — reached here as three segments. `parseModelId`
   * splits at the first slash and keeps the rest, leaving a model id no
   * provider carries, and the run's cost vanished from the issue's total with
   * no failure anywhere.
   */
  test('a model id that still carries a provider prefix prices under nothing', async () => {
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('anthropic/claude-sonnet-5', 'openai') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved).toEqual({ usd: null, source: 'none' })
  })

  /**
   * The other half of the same defect: a reference naming the wrong provider
   * misses its primary row and falls back to the median across every provider
   * publishing that model id — a figure that reads exact and is not. Naming the
   * provider that served the run is what buys the row's own rates.
   */
  test('the provider named decides whether the run gets a row’s own rates or a median', async () => {
    const own = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5', 'anthropic') },
      { log: silent, loadDb: loadDb(DB) },
    )
    const median = await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5', 'zai-coding-plan') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(own).toEqual({ usd: 18, source: 'catalogue' })
    expect(median).toEqual({ usd: 18.3, source: 'catalogue' })
  })

  test('names the rung that answered in the run log, so a figure needs no rerun to explain', async () => {
    const debugs: Array<{ meta: unknown; message: string }> = []
    const log: Logger = {
      debug: (meta: unknown, message: string): void => void debugs.push({ meta, message }),
      info: () => {},
      warn: () => {},
      error: () => {},
    }

    await resolveRunCost(
      { backendUsd: 0, buckets: BUCKETS, settings: settings('claude-sonnet-5') },
      { log, loadDb: loadDb(DB) },
    )

    expect(debugs.some((entry) => JSON.stringify(entry.meta).includes('catalogue'))).toBe(true)
  })
})

describe('resolveRunCost · one arithmetic, two workspaces', () => {
  /**
   * The spec's cross-workspace scenario. Not "the numbers happen to match" but
   * "the same function produced both": if the ladder ever grows its own copy of
   * the arithmetic, this fails even when the copy is correct today.
   */
  test('the catalogue rung agrees with sdd-runner’s repricing on the same counts and rates', async () => {
    const buckets = {
      input: 1_000_000,
      output: 500_000,
      reasoning: 250_000,
      cacheRead: 2_000_000,
      cacheWrite: 1_000_000,
    }
    const resolved = await resolveRunCost(
      { backendUsd: 0, buckets, settings: settings('claude-sonnet-5') },
      { log: silent, loadDb: loadDb(DB) },
    )

    expect(resolved.usd).toBe(costOfUsage(buckets, { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 }))
  })
})
