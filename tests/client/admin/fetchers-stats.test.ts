// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { fetchStatsGlobal } from '../../../client/admin/fetchers.js'
import type { StatsWindow } from '../../../src/stats/types.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const captured: Array<{ readonly url: string; readonly init: RequestInit }> = []

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
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }),
    )
  })
}

const firstCaptured = (): { readonly url: string; readonly init: RequestInit } => {
  const first = captured[0]
  if (first === undefined) throw new Error('missing captured fetch call')
  return first
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
  llmUsage: {
    totalCalls: 0,
    mainCalls: 0,
    smallCalls: 0,
    embeddingCalls: 0,
    inputTokensTotal: 0,
    outputTokensTotal: 0,
  },
  ...overrides,
})

describe('fetchStatsGlobal', () => {
  test('GETs /stats/global with the selected window', async () => {
    installFetch(200, {
      generatedAt: 0,
      window: '7d',
      subjects: { dmTotal: 1, groupTotal: 2, growthLast30d: [] },
      active: { activeIn1d: 1, activeIn7d: 2, activeIn30d: 3 },
      distributions: {
        memosPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        recurringTasksPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        messageMetadataPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
        attachmentBytesPerSubject: { count: 0, min: 0, p50: 0, p90: 0, p99: 0, max: 0, mean: 0 },
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
      llmUsage: {
        totalCalls: 0,
        mainCalls: 0,
        smallCalls: 0,
        embeddingCalls: 0,
        inputTokensTotal: 0,
        outputTokensTotal: 0,
      },
    })

    const result = await fetchStatsGlobal('7d')

    expect(firstCaptured().url).toBe('/stats/global?window=7d')
    expect(result.window).toBe('7d')
  })

  test('defaults to no query param when window is omitted', async () => {
    installFetch(200, fullGlobalPayload({}))
    const missingWindow: StatsWindow | undefined = undefined

    const result = await fetchStatsGlobal(missingWindow)

    expect(firstCaptured()).toEqual({ url: '/stats/global', init: {} })
    expect(result.window).toBe('30d')
  })

  test('throws on non-2xx with the server error message', async () => {
    installFetch(400, { error: 'unknown window' })

    await expect(fetchStatsGlobal('7d')).rejects.toThrow('unknown window')
  })
})
