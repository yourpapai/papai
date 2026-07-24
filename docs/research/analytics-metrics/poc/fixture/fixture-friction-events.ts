// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEvent } from './fixture-contract.js'
import { atIndex, makeTurnEvent, toolKey } from './fixture-primitives.js'
import type { TurnInput, TurnOutcome } from './fixture-types.js'

function makeRephrase(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  key: number,
): readonly AnalyticsEvent[] {
  if (input.followup !== true && key % 13 !== 0) return []
  return [
    makeTurnEvent(input, turn, session, 'rephrase', 'rephrase_detected', 1_150, {
      detector: key % 2 === 0 ? 'lexical_v1' : 'small_model_v1',
      similarity: key % 3 === 0 ? 'ge_095' : '090_094',
      prior_outcome: outcome === 'success' ? 'no_action' : 'failure',
      gap: 'le_2m',
    }),
  ]
}

function makeClarification(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  if (outcome === 'abandoned') {
    return [
      makeTurnEvent(input, turn, session, 'clarification-requested', 'clarification_requested', 1_250, {
        reason: 'ambiguous_target',
      }),
      makeTurnEvent(input, turn, session, 'clarification-abandoned', 'clarification_abandoned', durationMs - 300, {
        observation_hours: 24,
      }),
    ]
  }
  return key % 29 === 0
    ? [
        makeTurnEvent(input, turn, session, 'clarification-requested', 'clarification_requested', 1_250, {
          reason: 'missing_required_input',
        }),
      ]
    : []
}

function makeConfirmation(input: TurnInput, turn: string, session: string, key: number): readonly AnalyticsEvent[] {
  const tool = input.intent.tool
  if (key % 17 !== 0 || tool === null) return []
  return [
    makeTurnEvent(input, turn, session, 'confirmation-requested', 'confirmation_requested', 1_350, {
      tool_slug: tool.slug,
      tool_key: toolKey(tool),
      risk: tool.risk,
      timeout_ms: 300_000,
    }),
    makeTurnEvent(input, turn, session, 'confirmation-resolved', 'confirmation_resolved', 2_000, {
      tool_slug: tool.slug,
      tool_key: toolKey(tool),
      decision: atIndex(['granted', 'denied', 'ignored', 'prompt_failed'] as const, key),
      decision_latency_ms: 650,
    }),
  ]
}

function makeSteering(input: TurnInput, turn: string, session: string, key: number): readonly AnalyticsEvent[] {
  return key % 11 === 0
    ? [
        makeTurnEvent(input, turn, session, 'steered', 'turn_steered', 2_100, {
          ordinal: 1,
          length_bucket: '33_128',
          ack_sent: true,
        }),
      ]
    : []
}

function makeStop(
  input: TurnInput,
  turn: string,
  session: string,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  return key % 19 === 0
    ? [
        makeTurnEvent(input, turn, session, 'stop', 'turn_stop_requested', durationMs - 500, {
          stage: key % 38 === 0 ? 'forced' : 'graceful',
        }),
      ]
    : []
}

function makeDisclosure(
  input: TurnInput,
  turn: string,
  session: string,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  return key % 23 === 0
    ? [
        makeTurnEvent(input, turn, session, 'disclosure', 'disclosure_fallback', durationMs - 400, {
          reason: key % 46 === 0 ? 'no_real_load' : 'meta_tool_churn',
          step_bucket: '3_5',
        }),
      ]
    : []
}

export function makeInteractionEvents(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  durationMs: number,
  key: number,
): readonly AnalyticsEvent[] {
  return [
    ...makeRephrase(input, turn, session, outcome, key),
    ...makeClarification(input, turn, session, outcome, durationMs, key),
    ...makeConfirmation(input, turn, session, key),
    ...makeSteering(input, turn, session, key),
    ...makeStop(input, turn, session, durationMs, key),
    ...makeDisclosure(input, turn, session, durationMs, key),
  ]
}
