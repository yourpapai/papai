// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type {
  AnalyticsHealthCounter,
  AnalyticsRuntimeHealth,
  QueuedAggregateIncrement,
  QueuedPseudonymousEvent,
  RuntimeSinks,
} from './runtime.js'

export type RecordingHealth = AnalyticsRuntimeHealth & Readonly<{ counts: Record<AnalyticsHealthCounter, number> }>

export const createRecordingHealth = (): RecordingHealth => {
  const counts = { queue_full: 0, observer_failure: 0, normalization_rejection: 0 }
  return {
    counts,
    increment: (counter) => {
      counts[counter] += 1
    },
  }
}

export type RecordingSinks = Readonly<{
  sinks: RuntimeSinks
  events: QueuedPseudonymousEvent[]
  aggregates: QueuedAggregateIncrement[]
}>

export const createRecordingSinks = (): RecordingSinks => {
  const events: QueuedPseudonymousEvent[] = []
  const aggregates: QueuedAggregateIncrement[] = []
  return {
    events,
    aggregates,
    sinks: {
      writeEvents: (items) => {
        events.push(...items)
      },
      writeAggregates: (items) => {
        aggregates.push(...items)
      },
    },
  }
}
