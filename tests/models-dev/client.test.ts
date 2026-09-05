// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, utimesSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  MODELS_DEV_FETCH_TIMEOUT_MS,
  MODELS_DEV_TTL_MS,
  MODELS_DEV_URL,
  defaultModelsDevCachePath,
  getModelsDevSnapshot,
  prewarmModelsDevSnapshot,
  refreshModelsDevSnapshot,
  resetModelsDevSnapshotForTest,
} from '../../src/models-dev/client.js'
import { mockLogger, waitFor } from '../utils/test-helpers.js'

const NOW = 1_700_000_000_000

const catalogueBody = JSON.stringify({
  openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
  anthropic: { models: { 'claude-opus-4': { limit: { context: 200_000, output: 32_000 } } } },
})

const staticFetch =
  (body: string) =>
  (_signal: AbortSignal): Promise<string> =>
    Promise.resolve(body)

const failingFetch =
  (message = 'models.dev unreachable') =>
  (_signal: AbortSignal): Promise<string> =>
    Promise.reject(new Error(message))

const hangingFetch = (signal: AbortSignal): Promise<string> =>
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new Error('request aborted by timeout')))
  })

describe('models-dev client', () => {
  let cachePath: string

  beforeEach(() => {
    mockLogger()
    resetModelsDevSnapshotForTest()
    cachePath = mkdtempSync(path.join(os.tmpdir(), 'models-dev-client-')) + '/models.json'
  })

  afterEach(() => {
    resetModelsDevSnapshotForTest()
    rmSync(path.dirname(cachePath), { recursive: true, force: true })
  })

  test('pins the models.dev domain, bounds, and cache location', () => {
    expect(MODELS_DEV_URL).toBe('https://models.dev/api.json')
    expect(MODELS_DEV_FETCH_TIMEOUT_MS).toBe(10_000)
    expect(MODELS_DEV_TTL_MS).toBe(60 * 60 * 1000)
    expect(defaultModelsDevCachePath().endsWith(path.join('.cache', 'papai', 'models.json'))).toBe(true)
  })

  test('serves an empty snapshot with a null fetch time before any load', () => {
    expect(getModelsDevSnapshot()).toEqual({ fetchedAt: null, providers: {} })
  })

  test('prewarm fetches the catalogue into the in-memory snapshot', async () => {
    let seenSignal: AbortSignal | null = null
    const fetchImpl = (signal: AbortSignal): Promise<string> => {
      seenSignal = signal
      return Promise.resolve(catalogueBody)
    }

    await prewarmModelsDevSnapshot({ fetchImpl, cachePath, now: () => NOW })

    expect(seenSignal).toBeInstanceOf(AbortSignal)
    expect(getModelsDevSnapshot()).toEqual({
      fetchedAt: NOW,
      providers: {
        openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
        anthropic: { models: { 'claude-opus-4': { limit: { context: 200_000, output: 32_000 } } } },
      },
    })
  })

  test('getSnapshot never triggers an outbound fetch', async () => {
    let fetches = 0
    const fetchImpl = (_signal: AbortSignal): Promise<string> => {
      fetches += 1
      return Promise.resolve(catalogueBody)
    }
    await prewarmModelsDevSnapshot({ fetchImpl, cachePath, now: () => NOW, ttlMs: 3_600_000 })

    void getModelsDevSnapshot()
    void getModelsDevSnapshot()
    await Promise.resolve()

    expect(fetches).toBe(1)
  })

  test('a malformed body degrades to the previous snapshot', async () => {
    await prewarmModelsDevSnapshot({ fetchImpl: staticFetch(catalogueBody), cachePath, now: () => NOW })
    const before = getModelsDevSnapshot()

    await refreshModelsDevSnapshot({ fetchImpl: staticFetch('<html>not json</html>'), now: () => NOW + 5 })

    expect(getModelsDevSnapshot()).toEqual(before)
    expect(getModelsDevSnapshot().fetchedAt).toBe(NOW)
  })

  test('a failed first fetch leaves the empty snapshot', async () => {
    await prewarmModelsDevSnapshot({ fetchImpl: failingFetch(), cachePath, now: () => NOW })

    expect(getModelsDevSnapshot()).toEqual({ fetchedAt: null, providers: {} })
  })

  test('a failed refresh keeps the last good snapshot', async () => {
    await prewarmModelsDevSnapshot({ fetchImpl: staticFetch(catalogueBody), cachePath, now: () => NOW })
    const before = getModelsDevSnapshot()

    await refreshModelsDevSnapshot({ fetchImpl: failingFetch(), now: () => NOW + 5 })

    expect(getModelsDevSnapshot()).toEqual(before)
  })

  test('the fetch is bounded by an abort signal the injected impl can honor', async () => {
    await prewarmModelsDevSnapshot({
      fetchImpl: hangingFetch,
      cachePath,
      now: () => NOW,
      fetchTimeoutMs: 25,
    })

    expect(getModelsDevSnapshot()).toEqual({ fetchedAt: null, providers: {} })
  })

  test('malformed fields, entries, and providers degrade individually', async () => {
    const body = JSON.stringify({
      openai: {
        models: {
          good: { limit: { context: 1000, output: 100 } },
          'bad-limit': { limit: 'oops' },
          'bad-entry': 42,
        },
      },
      'bad-provider': 7,
      'bad-models': { models: 'nope' },
    })

    await prewarmModelsDevSnapshot({ fetchImpl: staticFetch(body), cachePath, now: () => NOW })

    expect(getModelsDevSnapshot()).toEqual({
      fetchedAt: NOW,
      providers: {
        openai: {
          models: {
            good: { limit: { context: 1000, output: 100 } },
            'bad-limit': {},
          },
        },
        'bad-models': { models: {} },
      },
    })
  })

  test('a fresh disk cache is served without any fetch', async () => {
    let fetches = 0
    const countingFetch = (_signal: AbortSignal): Promise<string> => {
      fetches += 1
      return Promise.resolve(catalogueBody)
    }
    await prewarmModelsDevSnapshot({ fetchImpl: countingFetch, cachePath, now: () => NOW })
    expect(existsSync(cachePath)).toBe(true)
    const fetchesAfterFirstLoad = fetches

    resetModelsDevSnapshotForTest()
    await prewarmModelsDevSnapshot({ fetchImpl: countingFetch, cachePath, now: () => NOW + 1000 })

    expect(fetches).toBe(fetchesAfterFirstLoad)
    expect(getModelsDevSnapshot().providers).toEqual({
      openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
      anthropic: { models: { 'claude-opus-4': { limit: { context: 200_000, output: 32_000 } } } },
    })
    expect(getModelsDevSnapshot().fetchedAt).toBeGreaterThan(0)
  })

  test('a stale disk cache is served immediately while a refresh is attempted', async () => {
    await prewarmModelsDevSnapshot({ fetchImpl: staticFetch(catalogueBody), cachePath, now: () => NOW })
    const stale = new Date(NOW - 2 * MODELS_DEV_TTL_MS)
    utimesSync(cachePath, stale, stale)
    resetModelsDevSnapshotForTest()

    let fetches = 0
    const countingFetch = failingFetch('offline')
    const wrapped = (signal: AbortSignal): Promise<string> => {
      fetches += 1
      return countingFetch(signal)
    }
    await prewarmModelsDevSnapshot({ fetchImpl: wrapped, cachePath, now: () => NOW })

    expect(fetches).toBe(1)
    expect(getModelsDevSnapshot().providers).toEqual({
      openai: { models: { 'gpt-4o': { limit: { context: 128_000, output: 16_384 } } } },
      anthropic: { models: { 'claude-opus-4': { limit: { context: 200_000, output: 32_000 } } } },
    })
    expect(getModelsDevSnapshot().fetchedAt).toBe(NOW - 2 * MODELS_DEV_TTL_MS)
  })

  test('prewarm deduplicates concurrent calls into one fetch', async () => {
    let fetches = 0
    const slowFetch = (_signal: AbortSignal): Promise<string> => {
      fetches += 1
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(catalogueBody)
        }, 25)
      })
    }

    const first = prewarmModelsDevSnapshot({ fetchImpl: slowFetch, cachePath, now: () => NOW })
    const second = prewarmModelsDevSnapshot({ fetchImpl: slowFetch, cachePath, now: () => NOW })
    await Promise.all([first, second])

    expect(fetches).toBe(1)
  })

  test('background refresh fires when the TTL expires', async () => {
    let fetches = 0
    let now = NOW
    const countingFetch = (_signal: AbortSignal): Promise<string> => {
      fetches += 1
      return Promise.resolve(catalogueBody)
    }

    await prewarmModelsDevSnapshot({ fetchImpl: countingFetch, cachePath, now: () => now, ttlMs: 25 })
    expect(fetches).toBe(1)

    now = NOW + 1000
    await waitFor(() => fetches >= 2, 5000)

    expect(getModelsDevSnapshot().fetchedAt).toBe(NOW + 1000)
  })
})
