// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { offlineResourceMetrics } from '../../scripts/memory-research/candidates/shared.js'

test('resource RSS is sampled before report-only persistent-state serialization', () => {
  const calls: string[] = []
  const persistentState = {
    toJSON: (): Readonly<{ index: string }> => {
      calls.push('serialize')
      return { index: 'persistent-index' }
    },
  }
  const readRssBytes = (): number => {
    calls.push('rss')
    return 125
  }

  const metrics = offlineResourceMetrics(
    [],
    { ingestedEventCount: 0, ingestDurationMs: 0, retrievalCount: 0 },
    persistentState,
    100,
    readRssBytes,
  )

  expect(calls).toEqual(['rss', 'serialize'])
  expect(metrics.incrementalRssBytes).toBe(25)
  expect(metrics.storedBytes).toBeGreaterThan(0)
})
