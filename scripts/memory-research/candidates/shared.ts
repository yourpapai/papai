// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AssembledContext, MemoryEvent, MemoryHit, MemoryScope, ResourceMetrics } from '../types.js'

export type StoredMemoryEvent = Readonly<{
  event: MemoryEvent
  archived: boolean
  vector: readonly number[] | null
}>

export type ResourceCounters = Readonly<{
  ingestedEventCount: number
  ingestDurationMs: number
  retrievalCount: number
}>

export const sameScope = (left: MemoryScope, right: MemoryScope): boolean =>
  left.kind === right.kind && left.id === right.id

export const compareRecency = (left: MemoryEvent, right: MemoryEvent): number =>
  right.ingestTime.localeCompare(left.ingestTime) ||
  right.eventTime.localeCompare(left.eventTime) ||
  left.evidenceId.localeCompare(right.evidenceId) ||
  left.eventId.localeCompare(right.eventId)

export const countTokens = (text: string): number => text.trim().match(/\S+/gu)?.length ?? 0

export const elapsedDurationMs = (startedAt: number, completedAt: number): number => {
  const durationMs = completedAt - startedAt
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('monotonic clock returned an invalid duration')
  return durationMs
}

export const assembleBoundedContext = (
  events: readonly MemoryEvent[],
  contextTokenBudget: number,
): AssembledContext => {
  const assembled = events.reduce<
    Readonly<{ text: readonly string[]; evidenceIds: readonly string[]; tokenCount: number }>
  >(
    (current, event) => {
      const eventTokenCount = countTokens(event.content)
      return current.tokenCount + eventTokenCount > contextTokenBudget
        ? current
        : {
            text: [...current.text, event.content],
            evidenceIds: [...current.evidenceIds, event.evidenceId],
            tokenCount: current.tokenCount + eventTokenCount,
          }
    },
    { text: [], evidenceIds: [], tokenCount: 0 },
  )
  return { text: assembled.text.join('\n'), evidenceIds: assembled.evidenceIds, tokenCount: assembled.tokenCount }
}

export const memoryHit = (
  event: MemoryEvent,
  rank: number,
  score: Readonly<{ dense?: number; lexical?: number }> = {},
): MemoryHit => {
  const dense = score.dense ?? 0
  const lexical = score.lexical ?? 0
  return {
    evidenceId: event.evidenceId,
    sourceEventId: event.eventId,
    scope: event.scope,
    score: { lexical, dense, graph: 0, recency: 0, total: dense + lexical },
    rank,
    content: event.content,
    validity: event.validity,
    provenance: { kind: 'canonical', derivedFromEvidenceIds: [] },
  }
}

export const offlineResourceMetrics = (
  rows: readonly StoredMemoryEvent[],
  counters: ResourceCounters,
  persistentState: unknown = [],
  baselineRssBytes = process.memoryUsage.rss(),
  readRssBytes: () => number = () => process.memoryUsage.rss(),
): ResourceMetrics => {
  const currentRssBytes = readRssBytes()
  const ingestThroughputPerSecond =
    counters.ingestedEventCount === 0 || counters.ingestDurationMs === 0
      ? 0
      : Math.min(Number.MAX_VALUE, (counters.ingestedEventCount * 1_000) / counters.ingestDurationMs)
  const eventBytes = rows.reduce(
    (sum, { event, vector }) =>
      sum + new TextEncoder().encode(JSON.stringify(event)).byteLength + (vector?.length ?? 0) * 8,
    0,
  )
  const serializedState = JSON.stringify(persistentState)
  const stateBytes =
    serializedState === '[]' || serializedState === '{"inverted":[],"tombstones":[]}'
      ? 0
      : new TextEncoder().encode(serializedState).byteLength
  return {
    ingestedEventCount: counters.ingestedEventCount,
    ingestDurationMs: counters.ingestDurationMs,
    ingestThroughputPerSecond,
    retrievalCount: counters.retrievalCount,
    modelCallCount: 0,
    extractorCallCount: 0,
    storedBytes: eventBytes + stateBytes,
    incrementalRssBytes: Math.max(0, currentRssBytes - baselineRssBytes),
  }
}
