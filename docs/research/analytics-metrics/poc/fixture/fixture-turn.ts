// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { makeAvailabilityEvents } from './fixture-availability-events.js'
import type { AnalyticsEvent } from './fixture-contract.js'
import { makeInteractionEvents } from './fixture-friction-events.js'
import { attemptKey, makeTurnEvent, modelKey, sessionKey, turnKey } from './fixture-primitives.js'
import { effectiveOutcome, intentGoals } from './fixture-taxonomy.js'
import { makeToolEvents } from './fixture-tool-events.js'
import type { TurnInput, TurnOutcome } from './fixture-types.js'

const classificationStrategy = (input: TurnInput, key: number): string => {
  if (input.intent.intent === 'unknown') return 'small_model_v1'
  if (input.intent.tool === null) return 'metadata_v1'
  return key % 5 === 0 ? 'hybrid_v1' : 'tool_trace_v1'
}

function makeInputFacts(input: TurnInput, turn: string, session: string, key: number): readonly AnalyticsEvent[] {
  const attachmentCount = input.intent.intent === 'attachment.manage' ? '1' : '0'
  return [
    makeTurnEvent(input, turn, session, 'message', 'chat_message_accepted', 0, {
      input_count: '1',
      length_bucket: input.intent.intent === 'no_action' ? '1_32' : '33_128',
      attachment_count: attachmentCount,
      is_command: input.invocationMode === 'command',
      command: input.invocationMode === 'command' ? 'config' : 'none',
    }),
    makeTurnEvent(input, turn, session, 'auth', 'auth_checked', 10, {
      outcome: 'granted',
      reason: input.actor.actorRole === 'admin' ? 'admin' : input.contextType === 'dm' ? 'open_dm' : 'member',
    }),
    makeTurnEvent(input, turn, session, 'started', 'turn_started', 50, {
      incoming_message_count: '1',
      attachment_count: attachmentCount,
      queue_wait_ms: 20 + (key % 1_200),
    }),
  ]
}

function makeIntentFact(input: TurnInput, turn: string, session: string, key: number): AnalyticsEvent {
  const primary = input.intent.intent
  return makeTurnEvent(input, turn, session, 'intent', 'intent_classified', 200, {
    taxonomy: 'intent.v1',
    primary,
    goals: intentGoals(primary),
    confidence: primary === 'unknown' ? 'lt_050' : primary === 'no_action' ? '070_084' : 'ge_095',
    strategy: classificationStrategy(input, key),
    abstained: primary === 'unknown',
  })
}

function makeLlmStarted(input: TurnInput, turn: string, session: string): AnalyticsEvent {
  return makeTurnEvent(input, turn, session, 'llm-started', 'llm_started', 300, {
    attempt_key: attemptKey(turn),
    model_key: modelKey(input.actor.platform),
    model_role: 'main',
    phase: 'generation',
    message_count: '1',
    available_tool_count: input.intent.tool === null ? '0' : '11_20',
  })
}

function makeLlmTerminal(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  key: number,
  failed: boolean,
): AnalyticsEvent {
  const shared = {
    attempt_key: attemptKey(turn),
    model_key: modelKey(input.actor.platform),
    model_role: 'main',
  } as const
  if (failed) {
    return makeTurnEvent(input, turn, session, 'llm-failed', 'llm_failed', 2_000, {
      ...shared,
      phase: 'stream',
      error_class: key % 2 === 0 ? 'timeout' : 'llm_provider',
      retryable: true,
      duration_ms: 1_700,
    })
  }
  return makeTurnEvent(input, turn, session, 'llm-completed', 'llm_completed', 2_000, {
    ...shared,
    duration_ms: 1_700,
    time_to_first_token_ms:
      input.intent.tool === null && input.intent.intent === 'no_action' ? null : 100 + (key % 1_400),
    input_tokens: 80 + (key % 900),
    output_tokens: 20 + (key % 300),
    step_count: input.intent.tool === null ? 1 : outcome === 'recovered' || outcome === 'abandoned' ? 3 : 2,
    finish_reason: input.intent.tool === null ? 'stop' : 'tool_calls',
  })
}

function makeAuxiliaryEvents(input: TurnInput, turn: string, session: string, key: number): readonly AnalyticsEvent[] {
  const rateLimit =
    key % 47 === 0
      ? [
          makeTurnEvent(input, turn, session, 'rate-limit', 'rate_limit_blocked', 2_300, {
            limit: key % 94 === 0 ? 'web_fetch' : 'provider',
          }),
        ]
      : []
  const unconfigured =
    input.taskProvider === 'none' && input.intent.tool?.domain === 'task' && key % 5 === 0
      ? [
          makeTurnEvent(input, turn, session, 'unconfigured', 'unconfigured_reply', 2_350, {
            missing: 'task_instance',
            surface: 'chat',
          }),
        ]
      : []
  return [...rateLimit, ...unconfigured]
}

function makeTurnCompleted(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  key: number,
  durationMs: number,
  llmFailure: boolean,
  toolEvents: readonly AnalyticsEvent[],
  availability: readonly AnalyticsEvent[],
): AnalyticsEvent {
  const repeatedAttempt = outcome === 'recovered' || outcome === 'abandoned'
  const liveStatusUsed = availability.some(
    ({ eventName, props }) =>
      eventName === 'live_status_lifecycle' && props['stage'] === 'create' && props['outcome'] === 'success',
  )
  return makeTurnEvent(input, turn, session, 'completed', 'turn_completed', durationMs, {
    outcome: llmFailure ? 'llm_error' : key % 19 === 0 ? 'graceful_stop' : 'ok',
    duration_ms: durationMs,
    step_count: input.intent.tool === null ? 1 : repeatedAttempt ? 3 : 2,
    tool_call_count: toolEvents.filter(({ eventName }) => eventName === 'tool_completed').length,
    reply_count: '1',
    finish_reason: llmFailure ? 'error' : input.intent.tool === null ? 'stop' : 'tool_calls',
    clarification: outcome === 'abandoned',
    live_status_used: liveStatusUsed,
  })
}

export function makeTurn(input: TurnInput): readonly AnalyticsEvent[] {
  const turn = turnKey(input.actor, input.day, input.slot)
  const session = sessionKey(input.actor, input.day, input.contextType)
  const key = input.actor.index * 41 + input.day * 23 + input.slot * 13
  const outcome = effectiveOutcome(input)
  const llmFailure = input.forceLlmSuccess === true ? false : key % 37 === 0
  const durationMs = key % 13 === 0 ? 31_000 + (key % 45_000) : 9_000 + (key % 18_000)
  const availability = makeAvailabilityEvents(input, turn, session, durationMs, key)
  const toolEvents = llmFailure ? [] : makeToolEvents(input, turn, session, outcome, key)
  const replyAt = Math.max(3_000, durationMs - 800)
  return [
    ...makeInputFacts(input, turn, session, key),
    ...availability,
    makeIntentFact(input, turn, session, key),
    makeLlmStarted(input, turn, session),
    makeLlmTerminal(input, turn, session, outcome, key, llmFailure),
    ...toolEvents,
    ...makeInteractionEvents(input, turn, session, outcome, durationMs, key),
    ...makeAuxiliaryEvents(input, turn, session, key),
    makeTurnEvent(input, turn, session, 'reply', 'reply_sent', replyAt, {
      latency_ms: replyAt - 50,
      part_count: '1',
      length_bucket: '33_128',
      delivery: 'success',
    }),
    makeTurnCompleted(input, turn, session, outcome, key, durationMs, llmFailure, toolEvents, availability),
  ]
}
