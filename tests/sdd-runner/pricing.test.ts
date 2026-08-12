// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadDb } from '../../sdd-runner/src/pricing.js'
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
  return db[provider]!.models[model]!.cost.input
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
