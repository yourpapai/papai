// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadDb } from '../../sdd-runner/src/pricing.js'
import { MODELS_DEV_FETCH_TIMEOUT_MS, MODELS_DEV_URL } from '../../sdd-runner/src/pricing.js'
import { parseModelId } from '../../sdd-runner/src/pricing.js'
import { resolveCost } from '../../sdd-runner/src/pricing.js'
import type { ModelsDevDb } from '../../sdd-runner/src/pricing.js'

const tmpDirs: string[] = []

function makeDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdd-price-'))
  tmpDirs.push(dir)
  return dir
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop()
    if (dir !== undefined) fs.rmSync(dir, { recursive: true, force: true })
  }
})

describe('parseModelId', () => {
  it('splits on the first slash into providerID + modelID', () => {
    expect(parseModelId('zai-coding-plan/glm-5.2')).toEqual({
      providerID: 'zai-coding-plan',
      modelID: 'glm-5.2',
    })
    expect(parseModelId('openai/gpt-5')).toEqual({ providerID: 'openai', modelID: 'gpt-5' })
  })

  it('treats a model id with multiple slashes as provider = first segment', () => {
    expect(parseModelId('foo/bar/baz')).toEqual({ providerID: 'foo', modelID: 'bar/baz' })
  })

  it('throws on an id with no slash', () => {
    expect(() => parseModelId('noprobvider')).toThrow()
  })
})

function cost(input: number, output: number): { input: number; output: number } {
  return { input, output }
}

function inputCostOf(db: ModelsDevDb, provider: string, model: string): number {
  // `cost` is optional in the schema (models.dev ships hundreds of entries without one), so a
  // missing price is a real possibility here rather than a type-system formality.
  const entry = db[provider]?.models[model]?.cost
  if (entry === undefined) throw new Error(`no cost recorded for ${provider}/${model}`)
  return entry.input
}

function buildFixture(): ModelsDevDb {
  // paid provider with a non-zero price for model "m" (PRIMARY path)
  // sub provider with a zero (subscription) price for model "m" (FALLBACK path)
  // 6 other providers with mixed non-zero costs for model "m"
  // a model "lonely" served by no one (LAST RESORT path)
  const db: Record<string, { models: Record<string, { cost: { input: number; output: number } }> }> = {
    paid: { models: { m: { cost: cost(5, 15) } } },
    sub: { models: { m: { cost: cost(0, 0) } } },
    p1: { models: { m: { cost: cost(1, 2) } } },
    p2: { models: { m: { cost: cost(3, 4) } } },
    p3: { models: { m: { cost: cost(5, 6) } } },
    p4: { models: { m: { cost: cost(7, 8) } } },
    p5: { models: { m: { cost: cost(9, 10) } } },
    p6: { models: { m: { cost: cost(11, 12) } } },
  }
  return db
}

describe('resolveCost', () => {
  it('returns the configured provider entry when its price is non-zero (PRIMARY)', () => {
    const result = resolveCost('paid/m', buildFixture())
    expect(result).not.toBeNull()
    const resolved = result!
    expect(resolved.input).toBe(5)
    expect(resolved.output).toBe(15)
    expect(resolved.source).toBe('primary')
  })

  it('returns the median across non-zero entries for a subscription provider (FALLBACK)', () => {
    const result = resolveCost('sub/m', buildFixture())
    expect(result).not.toBeNull()
    const resolved = result!
    // 7 non-zero entries: inputs [1,3,5,5,7,9,11] median=5; outputs [2,4,6,8,10,12,15] median=8
    expect(resolved.input).toBe(5)
    expect(resolved.output).toBe(8)
    expect(resolved.source).toBe('fallback')
  })

  it('returns null for a model served by no provider (LAST RESORT)', () => {
    expect(resolveCost('weird/lonely', buildFixture())).toBeNull()
  })
})

describe('loadDb', () => {
  it('uses a fresh seeded cache without fetching', async () => {
    const dir = makeDir()
    const cachePath = path.join(dir, 'models.json')
    const db = { p: { models: { m: { cost: { input: 1, output: 2 } } } } }
    fs.writeFileSync(cachePath, JSON.stringify(db))
    // bump mtime to "now" so the cache is fresh
    const now = new Date()
    fs.utimesSync(cachePath, now, now)

    let fetched = 0
    const result = await loadDb({
      cachePath,
      now: () => now,
      fetchImpl: () => {
        fetched += 1
        return Promise.resolve(JSON.stringify(db))
      },
    })
    expect(fetched).toBe(0)
    expect(inputCostOf(result, 'p', 'm')).toBe(1)
  })

  it('refetches when the cache mtime is stale', async () => {
    const dir = makeDir()
    const cachePath = path.join(dir, 'models.json')
    const stale = { p: { models: { m: { cost: { input: 1, output: 2 } } } } }
    fs.writeFileSync(cachePath, JSON.stringify(stale))
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(cachePath, staleTime, staleTime)

    const fresh = { p: { models: { m: { cost: { input: 9, output: 9 } } } } }
    let fetched = 0
    const result = await loadDb({
      cachePath,
      now: () => new Date(),
      fetchImpl: () => {
        fetched += 1
        return Promise.resolve(JSON.stringify(fresh))
      },
    })
    expect(fetched).toBe(1)
    expect(inputCostOf(result, 'p', 'm')).toBe(9)
  })

  /**
   * The defect that made the wrong URL invisible even after it was fixed: models.dev publishes
   * hundreds of entries with no `cost` at all, and a schema that required it rejected the whole
   * database over any one of them. `loadDb` caught the parse error and returned `{}`, so a fully
   * reachable, fully valid pricing table resolved every model to "unknown" with nothing logged.
   */
  it('keeps a priced model when a sibling entry has no cost at all', async () => {
    const dir = makeDir()
    const result = await loadDb({
      cachePath: path.join(dir, 'models.json'),
      now: () => new Date(),
      fetchImpl: () =>
        Promise.resolve(
          JSON.stringify({
            p: {
              models: {
                priced: { cost: { input: 3, output: 6 } },
                unpriced: { name: 'a local model with no pricing' },
              },
            },
          }),
        ),
    })
    expect(Object.keys(result)).toEqual(['p'])
    expect(inputCostOf(result, 'p', 'priced')).toBe(3)
    expect(resolveCost('p/unpriced', result)).toBeNull()
  })

  // Provider objects carry id/env/npm/name/doc alongside models; unknown keys must not reject.
  it('tolerates the provider metadata models.dev ships alongside models', async () => {
    const dir = makeDir()
    const result = await loadDb({
      cachePath: path.join(dir, 'models.json'),
      now: () => new Date(),
      fetchImpl: () =>
        Promise.resolve(
          JSON.stringify({
            p: {
              id: 'p',
              env: ['P_API_KEY'],
              npm: '@ai-sdk/openai-compatible',
              name: 'Provider',
              doc: 'https://example.invalid/docs',
              models: { m: { cost: { input: 1, output: 2 } } },
            },
          }),
        ),
    })
    expect(inputCostOf(result, 'p', 'm')).toBe(1)
  })

  /**
   * Pins the domain. `metrics.dev` — one character's worth of difference from the intended
   * host — is a parked lander that answers 200 with HTML, so the failure was totally silent:
   * parse throws, loadDb returns {}, every cost reads as unknown, nothing logs. Every other
   * test here injects `fetchImpl`, so this constant is the only thing left to assert against.
   */
  it('points at the models.dev pricing API, not a lookalike domain', () => {
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json')
  })

  // Cost is decoration on a gate summary; a hanging pricing host must not hold the gate.
  it('bounds the pricing fetch', () => {
    expect(MODELS_DEV_FETCH_TIMEOUT_MS).toBeGreaterThan(0)
    expect(MODELS_DEV_FETCH_TIMEOUT_MS).toBeLessThanOrEqual(30_000)
  })

  /**
   * The exact shape the wrong URL produced: a 200 whose body is an HTML lander. It must
   * degrade to an empty db rather than throwing, but note what that means — an unreachable or
   * wrong pricing source is indistinguishable from a priced model with no entry.
   */
  it('degrades to an empty db when the response is not the pricing JSON', async () => {
    const dir = makeDir()
    const result = await loadDb({
      cachePath: path.join(dir, 'models.json'),
      now: () => new Date(),
      fetchImpl: () => Promise.resolve('<!DOCTYPE html><html><head></head></html>'),
    })
    expect(result).toEqual({})
  })

  it('falls back to the stale cache when the refetch fails', async () => {
    const dir = makeDir()
    const cachePath = path.join(dir, 'models.json')
    const stale = { p: { models: { m: { cost: { input: 7, output: 7 } } } } }
    fs.writeFileSync(cachePath, JSON.stringify(stale))
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000)
    fs.utimesSync(cachePath, staleTime, staleTime)

    let fetched = 0
    const result = await loadDb({
      cachePath,
      now: () => new Date(),
      fetchImpl: () => {
        fetched += 1
        return Promise.reject(new Error('network down'))
      },
    })
    expect(fetched).toBe(1)
    expect(inputCostOf(result, 'p', 'm')).toBe(7)
  })
})
