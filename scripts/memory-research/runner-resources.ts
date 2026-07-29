// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ResourceMetrics } from './types.js'

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

const throughput = (eventCount: number, durationMs: number): number =>
  durationMs === 0 ? 0 : Math.min(Number.MAX_VALUE, (eventCount * 1_000) / durationMs)

export const aggregateExecutionResources = (measurements: readonly ResourceMetrics[]): ResourceMetrics => {
  const ingestedEventCount = sum(measurements.map(({ ingestedEventCount: value }) => value))
  const ingestDurationMs = sum(measurements.map(({ ingestDurationMs: value }) => value))
  return {
    ingestedEventCount,
    ingestDurationMs,
    ingestThroughputPerSecond: throughput(ingestedEventCount, ingestDurationMs),
    retrievalCount: sum(measurements.map(({ retrievalCount }) => retrievalCount)),
    modelCallCount: sum(measurements.map(({ modelCallCount }) => modelCallCount)),
    extractorCallCount: sum(measurements.map(({ extractorCallCount }) => extractorCallCount)),
    storedBytes: Math.max(0, ...measurements.map(({ storedBytes }) => storedBytes)),
    incrementalRssBytes: Math.max(0, ...measurements.map(({ incrementalRssBytes }) => incrementalRssBytes)),
  }
}
