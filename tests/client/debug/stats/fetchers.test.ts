// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchStatsGlobal } from '../../../../client/debug/stats/fetchers.js'
import type { StatsWindow } from '../../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../../utils/test-helpers.js'

const captured: Array<{ url: string; init: RequestInit }> = []

beforeEach(() => {
  captured.length = 0
})

afterEach(() => {
  restoreFetch()
})

const installFetch = (status: number, payload: unknown): void => {
  setMockFetch((url, init) => {
    captured.push({ url, init })
    return Promise.resolve(
      new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  })
}

const emptyPercentiles = { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 }

const fullGlobalPayload = (overrides: Record<string, unknown>): Record<string, unknown> => ({
  generatedAt: 1000,
  window: '30d',
  subjects: { dmTotal: 0, groupTotal: 0, growthLast30d: [] },
  active: { activeIn1d: 0, activeIn7d: 0, activeIn30d: 0 },
  distributions: {
    memosPerSubject: emptyPercentiles,
    recurringTasksPerSubject: emptyPercentiles,
    messageMetadataPerSubject: emptyPercentiles,
    attachmentBytesPerSubject: emptyPercentiles,
  },
  storage: { sqliteBytes: 0, s3AttachmentBytes: 0 },
  identityMix: { byProvider: {}, kaneoWorkspaces: 0 },
  surfaceMix: {
    subjectsWithRecurring: 0,
    subjectsWithDeferred: 0,
    subjectsWithMemos: 0,
    subjectsWithInstructions: 0,
  },
  webFetches: { topHosts: [] },
  toolMix: { topTools: [], errorTypeCounts: {} },
  ...overrides,
})

describe('fetchStatsGlobal', () => {
  test('GETs /stats/global with the requested window', async () => {
    installFetch(200, fullGlobalPayload({ window: '7d' }))
    const result = await fetchStatsGlobal('7d')
    expect(captured[0]).toEqual({ url: '/stats/global?window=7d', init: {} })
    expect(result.window).toBe('7d')
  })

  test('defaults to no query param when window is omitted', async () => {
    installFetch(200, fullGlobalPayload({}))
    const missingWindow: StatsWindow | undefined = undefined
    const result = await fetchStatsGlobal(missingWindow)
    expect(captured[0]).toEqual({ url: '/stats/global', init: {} })
    expect(result.window).toBe('30d')
  })

  test('throws on non-2xx with the server error message', async () => {
    installFetch(400, { error: 'unknown window' })
    await expect(fetchStatsGlobal('7d')).rejects.toThrow('unknown window')
  })
})
