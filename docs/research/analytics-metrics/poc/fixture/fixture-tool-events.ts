// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AnalyticsEvent, EventProps } from './fixture-contract.js'
import { atIndex, makeTurnEvent, toolKey } from './fixture-primitives.js'
import type { Actor, ToolSpec, TurnInput, TurnOutcome } from './fixture-types.js'

type ExecutionOutcome = 'semantic_success' | 'structured_failure' | 'thrown_failure'

const errorClassFor = (key: number): string =>
  atIndex(['validation', 'provider_4xx', 'provider_5xx', 'timeout', 'network', 'rate_limit'] as const, key)

const providerFor = (actor: Actor, tool: ToolSpec): 'kaneo' | 'youtrack' | 'magi' | 'other' => {
  if (tool.domain === 'task') return actor.assignedProvider === 'other' ? 'other' : actor.assignedProvider
  return tool.domain === 'coding' ? 'magi' : 'other'
}

export function toolStartedProps(tool: ToolSpec): EventProps {
  return {
    tool_slug: tool.slug,
    tool_key: toolKey(tool),
    origin: tool.origin,
    domain: tool.domain,
    risk: tool.risk,
    model_role: 'main',
    args_bytes: '257_1024',
  }
}

function toolCompletedProps(
  tool: ToolSpec,
  outcome: ExecutionOutcome,
  durationMs: number,
  recoveredSameTurn: boolean,
  errorClass: string | null,
): EventProps {
  const success = outcome === 'semantic_success'
  return {
    ...toolStartedProps(tool),
    duration_ms: durationMs,
    execution_outcome: outcome,
    result_bytes: success ? '257_1024' : '1_256',
    error_class: errorClass,
    status_class: success ? '2xx' : errorClass === 'provider_5xx' ? '5xx' : '4xx',
    retryable: success ? null : errorClass === 'provider_5xx' || errorClass === 'timeout',
    recovered_same_turn: recoveredSameTurn,
  }
}

function makeProviderEvent(
  input: TurnInput,
  tool: ToolSpec,
  turn: string,
  session: string,
  ordinal: number,
  completedAtMs: number,
  durationMs: number,
  outcome: ExecutionOutcome,
  errorClass: string | null,
): readonly AnalyticsEvent[] {
  if (!['task', 'coding', 'web'].includes(tool.domain)) return []
  const success = outcome === 'semantic_success'
  return [
    makeTurnEvent(
      input,
      turn,
      session,
      `tool:${ordinal}:provider`,
      'provider_request_completed',
      completedAtMs - input.baseAtMs + 10,
      {
        provider: providerFor(input.actor, tool),
        operation: tool.providerOperation,
        duration_ms: durationMs,
        outcome: success ? 'success' : 'failure',
        status_class: success ? '2xx' : errorClass === 'provider_5xx' ? '5xx' : '4xx',
        retryable: success ? null : errorClass === 'provider_5xx' || errorClass === 'timeout',
      },
    ),
  ]
}

function makeToolAttemptEvents(
  input: TurnInput,
  turn: string,
  session: string,
  ordinal: number,
  startOffsetMs: number,
  outcome: ExecutionOutcome,
  recoveredSameTurn: boolean,
  key: number,
): readonly AnalyticsEvent[] {
  const tool = input.intent.tool
  if (tool === null) return []
  const errorClass = outcome === 'semantic_success' ? null : errorClassFor(key + ordinal)
  const durationMs = 350 + ((key + ordinal * 211) % 4_500)
  const completedAtMs = input.baseAtMs + startOffsetMs + durationMs
  return [
    makeTurnEvent(
      input,
      turn,
      session,
      `tool:${ordinal}:started`,
      'tool_started',
      startOffsetMs,
      toolStartedProps(tool),
    ),
    makeTurnEvent(
      input,
      turn,
      session,
      `tool:${ordinal}:completed`,
      'tool_completed',
      completedAtMs - input.baseAtMs,
      toolCompletedProps(tool, outcome, durationMs, recoveredSameTurn, errorClass),
    ),
    ...makeProviderEvent(input, tool, turn, session, ordinal, completedAtMs, durationMs, outcome, errorClass),
  ]
}

export function makeToolEvents(
  input: TurnInput,
  turn: string,
  session: string,
  outcome: TurnOutcome,
  key: number,
): readonly AnalyticsEvent[] {
  if (input.intent.tool === null) return []
  if (outcome === 'success') {
    return makeToolAttemptEvents(input, turn, session, 1, 2_500, 'semantic_success', false, key)
  }
  if (outcome === 'recovered') {
    return [
      ...makeToolAttemptEvents(input, turn, session, 1, 2_500, 'structured_failure', false, key),
      ...makeToolAttemptEvents(input, turn, session, 2, 7_500, 'semantic_success', true, key),
    ]
  }
  if (outcome === 'abandoned') {
    return [
      ...makeToolAttemptEvents(input, turn, session, 1, 2_500, 'structured_failure', false, key),
      ...makeToolAttemptEvents(input, turn, session, 2, 7_500, 'thrown_failure', false, key),
    ]
  }
  return makeToolAttemptEvents(input, turn, session, 1, 2_500, 'structured_failure', false, key)
}
