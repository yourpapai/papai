// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { CandidateWorkerResult } from './report-schema.js'
import type { ResourceMetrics } from './types.js'

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

export const aggregateWorkerResources = (workers: readonly CandidateWorkerResult[]): ResourceMetrics => {
  const measured = workers.flatMap(({ resources }) => (resources === null ? [] : [resources]))
  const ingestedEventCount = sum(measured.map((measurement) => measurement.ingestedEventCount))
  const ingestDurationMs = sum(measured.map((measurement) => measurement.ingestDurationMs))
  return {
    ingestedEventCount,
    ingestDurationMs,
    ingestThroughputPerSecond: ingestDurationMs > 0 ? (ingestedEventCount * 1_000) / ingestDurationMs : 0,
    retrievalCount: sum(measured.map(({ retrievalCount }) => retrievalCount)),
    modelCallCount: sum(measured.map(({ modelCallCount }) => modelCallCount)),
    extractorCallCount: sum(measured.map(({ extractorCallCount }) => extractorCallCount)),
    storedBytes: Math.max(0, ...measured.map(({ storedBytes }) => storedBytes)),
    incrementalRssBytes: Math.max(0, ...measured.map(({ incrementalRssBytes }) => incrementalRssBytes)),
  }
}
