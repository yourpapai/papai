// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Derived attempt health: classifies LLM attempts from their start/terminal
 * observations. An attempt whose start never saw a terminal within the configured
 * observation timeout is `aged_open` — it is NEVER rewritten to a provider failure,
 * because no failure evidence exists.
 */

export type AttemptObservation = Readonly<{
  rawAttemptId: string
  startedAtMs: number
  terminalAtMs: number | null
}>

export type AttemptHealthStatus = 'closed' | 'open' | 'aged_open'

export type AttemptHealth = Readonly<{
  rawAttemptId: string
  status: AttemptHealthStatus
}>

const statusOf = (
  observation: AttemptObservation,
  nowMs: number,
  observationTimeoutMs: number,
): AttemptHealthStatus => {
  if (observation.terminalAtMs !== null) return 'closed'
  return nowMs - observation.startedAtMs > observationTimeoutMs ? 'aged_open' : 'open'
}

export const deriveAttemptHealth = (
  observations: readonly AttemptObservation[],
  nowMs: number,
  observationTimeoutMs: number,
): readonly AttemptHealth[] =>
  observations.map((observation) => ({
    rawAttemptId: observation.rawAttemptId,
    status: statusOf(observation, nowMs, observationTimeoutMs),
  }))
