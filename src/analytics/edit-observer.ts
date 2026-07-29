// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { performance } from 'node:perf_hooks'

import type { AuthorizationResult, IncomingMessage } from '../chat/types.js'
import { buildAnalyticsSourceContext, createAuthorizedTurnSeed } from './bot-observer.js'
import type { AuthorizedTurnSeed } from './bot-observer.js'
import type { AnalyticsObserver } from './runtime.js'
import type { EditClassifiedFact, EditRegenFact } from './source-facts-boundary.js'

export type EditWindow = 'w1' | 'w2' | 'w3'

export type EditRegenPhase =
  | 'prompt_shown'
  | 'prompt_adjust'
  | 'prompt_note'
  | 'regen_started'
  | 'regen_completed'
  | 'regen_failed'
  | 'history_only'

export function buildEditSeed(msg: IncomingMessage, auth: AuthorizationResult): AuthorizedTurnSeed | undefined {
  const source = buildAnalyticsSourceContext(msg, auth, 'normal', null)
  if (source === null) return undefined
  return createAuthorizedTurnSeed(source, msg, 0, {
    nowMs: () => Date.now(),
    nowMonotonicMs: () => performance.now(),
  })
}

export function buildEditClassifiedFact(
  source: AuthorizedTurnSeed['source'],
  input: Readonly<{ sourceEventId: string; window: EditWindow }>,
): EditClassifiedFact {
  return {
    version: 1,
    type: 'edit_classified',
    sourceEventId: input.sourceEventId,
    occurredAtMs: Date.now(),
    source,
    window: input.window,
  }
}

export function buildEditRegenFact(
  source: AuthorizedTurnSeed['source'],
  input: Readonly<{ sourceEventId: string; phase: EditRegenPhase; durationMs?: number }>,
): EditRegenFact {
  return {
    version: 1,
    type: 'edit_regen',
    sourceEventId: input.sourceEventId,
    occurredAtMs: Date.now(),
    source,
    phase: input.phase,
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
  }
}

export function observeEditClassified(observer: AnalyticsObserver, seed: AuthorizedTurnSeed, window: EditWindow): void {
  observer.observe(
    buildEditClassifiedFact(seed.source, { sourceEventId: `${seed.sourceEventId}:edit_classified`, window }),
  )
}

export function observeEditRegen(
  observer: AnalyticsObserver,
  seed: AuthorizedTurnSeed,
  phase: EditRegenPhase,
  durationMs?: number,
): void {
  observer.observe(
    buildEditRegenFact(seed.source, {
      sourceEventId: `${seed.sourceEventId}:edit_regen_${phase}`,
      phase,
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
  )
}
