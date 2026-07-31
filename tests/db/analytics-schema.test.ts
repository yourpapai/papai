// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  analyticsAggregateEpochContributions,
  analyticsBackfillAggregateContributions,
  analyticsBackfillEventMap,
  analyticsBackfillRuns,
  analyticsDailyCounters,
  analyticsDailyHistograms,
  analyticsEpochSourceCounters,
  analyticsEvents,
  analyticsNormalizationRejections,
  analyticsProcessEpochs,
} from '../../src/db/analytics-schema.js'

describe('analytics schema', () => {
  test('exports all ten foundation tables', () => {
    expect(analyticsProcessEpochs).toBeDefined()
    expect(analyticsEvents).toBeDefined()
    expect(analyticsDailyCounters).toBeDefined()
    expect(analyticsDailyHistograms).toBeDefined()
    expect(analyticsEpochSourceCounters).toBeDefined()
    expect(analyticsAggregateEpochContributions).toBeDefined()
    expect(analyticsNormalizationRejections).toBeDefined()
    expect(analyticsBackfillRuns).toBeDefined()
    expect(analyticsBackfillEventMap).toBeDefined()
    expect(analyticsBackfillAggregateContributions).toBeDefined()
  })
})
