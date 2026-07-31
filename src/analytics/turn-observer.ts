// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AuthorizationResult, IncomingMessage } from '../chat/types.js'
import type { QueueItem } from '../message-queue/types.js'
import type { RunControl } from '../run-control/types.js'
import type { AuthorizedTurnSeed } from './bot-observer.js'
import { buildAnalyticsSourceContext } from './bot-observer.js'
import type { AnalyticsObserver } from './runtime.js'
import type {
  AnalyticsSourceContext,
  GuestTurnAggregateFact,
  TurnCompletedFact,
  TurnStartedFact,
  TurnSteeredFact,
  TurnStopRequestedFact,
} from './source-facts.js'

/**
 * Merges per-message seeds when the queue coalesces inputs into one turn.
 * The last actor's source wins (matching the queue's last-reply rule), input
 * and attachment counts sum, and the earliest accept timestamps survive so
 * queue wait is measured monotonically from the first accepted message.
 */
export function mergeAnalyticsTurnSeeds(items: readonly QueueItem[]): AuthorizedTurnSeed | undefined {
  const seeds = items
    .map((item) => item.analyticsTurnSeed)
    .filter((seed): seed is AuthorizedTurnSeed => seed !== undefined)
  const first = seeds[0]
  const last = seeds.at(-1)
  if (first === undefined || last === undefined) return undefined
  return {
    sourceEventId: last.sourceEventId,
    acceptedAtMs: first.acceptedAtMs,
    acceptedAtMonotonicMs: first.acceptedAtMonotonicMs,
    source: last.source,
    inputCount: seeds.reduce((total, seed) => total + seed.inputCount, 0),
    inputLength: seeds.reduce((total, seed) => total + seed.inputLength, 0),
    attachmentCount: seeds.reduce((total, seed) => total + seed.attachmentCount, 0),
  }
}

export function buildTurnStartedFact(
  seed: AuthorizedTurnSeed,
  source: AnalyticsSourceContext,
  queueWaitMs: number,
): TurnStartedFact {
  return {
    version: 1,
    type: 'turn_started',
    sourceEventId: `${seed.sourceEventId}:turn_started`,
    occurredAtMs: Date.now(),
    source,
    incomingMessageCount: seed.inputCount,
    attachmentCount: seed.attachmentCount,
    queueWaitMs: Math.max(0, Math.round(queueWaitMs)),
  }
}

export function buildTurnCompletedFact(
  seed: AuthorizedTurnSeed,
  source: AnalyticsSourceContext,
  input: Readonly<{ outcome: 'ok' | 'llm_error'; durationMs: number; replyCount: number }>,
): TurnCompletedFact {
  return {
    version: 1,
    type: 'turn_completed',
    sourceEventId: `${seed.sourceEventId}:turn_completed`,
    occurredAtMs: Date.now(),
    source,
    outcome: input.outcome,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    stepCount: 0,
    toolCallCount: 0,
    replyCount: input.replyCount,
    finishReason: 'unknown',
    clarification: false,
    liveStatusUsed: false,
  }
}

export function buildGuestTurnAggregateFact(
  seed: AuthorizedTurnSeed,
  source: AnalyticsSourceContext,
  outcome: 'ok' | 'llm_error',
): GuestTurnAggregateFact {
  return {
    version: 1,
    type: 'guest_turn_aggregate',
    sourceEventId: `${seed.sourceEventId}:guest_turn`,
    occurredAtMs: Date.now(),
    source,
    utcDay: new Date(seed.acceptedAtMs).toISOString().slice(0, 10),
    turns: 1,
    successfulTurns: outcome === 'ok' ? 1 : 0,
    failedTurns: outcome === 'ok' ? 0 : 1,
    contextCount: 1,
  }
}

export function buildTurnSteeredFact(
  source: AnalyticsSourceContext,
  input: Readonly<{ sourceEventId: string; ordinal: number; steerLengthChars: number; ackSent: boolean }>,
): TurnSteeredFact {
  return {
    version: 1,
    type: 'turn_steered',
    sourceEventId: input.sourceEventId,
    occurredAtMs: Date.now(),
    source,
    ordinal: input.ordinal,
    steerLengthChars: input.steerLengthChars,
    ackSent: input.ackSent,
  }
}

export function buildTurnStopRequestedFact(
  source: AnalyticsSourceContext,
  stage: 'graceful' | 'forced',
): TurnStopRequestedFact {
  return {
    version: 1,
    type: 'turn_stop_requested',
    sourceEventId: `${source.rawTurnId ?? 'turn'}:stop:${stage}`,
    occurredAtMs: Date.now(),
    source,
    stage,
  }
}

const steerOrdinals = new WeakMap<RunControl, number>()

/** Per-run monotonic steer ordinal (1-based), tracked out-of-band so RunControl stays unchanged. */
export function nextSteerOrdinal(run: RunControl): number {
  const next = (steerOrdinals.get(run) ?? 0) + 1
  steerOrdinals.set(run, next)
  return next
}

/** Emits the bounded stop fact for a /stop stage against the run's raw turn ID. */
export function observeTurnStopRequested(
  observer: AnalyticsObserver | undefined,
  msg: IncomingMessage,
  auth: AuthorizationResult,
  rawTurnId: string,
  stage: 'graceful' | 'forced',
): void {
  if (observer === undefined) return
  const source = buildAnalyticsSourceContext(msg, auth, 'command', rawTurnId)
  if (source === null) return
  observer.observe(buildTurnStopRequestedFact(source, stage))
}
