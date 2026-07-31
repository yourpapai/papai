// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { z } from 'zod'

import type { AnalyticsEventV1 } from './contracts.js'
import type { AggregateCounterV1, AggregateHistogramV1 } from './controlled-types.js'
import { propsByEventName } from './event-props.js'

export type AggregateIncrement =
  | Readonly<{ kind: 'counter'; metric: AggregateCounterV1; delta: number }>
  | Readonly<{ kind: 'histogram'; metric: AggregateHistogramV1; valueMs: number }>

export const counter = (metric: AggregateCounterV1, delta = 1): AggregateIncrement => ({
  kind: 'counter',
  metric,
  delta,
})
export const histogram = (metric: AggregateHistogramV1, valueMs: number): AggregateIncrement => ({
  kind: 'histogram',
  metric,
  valueMs,
})

const parseWith = <S extends z.ZodType>(schema: S, props: unknown): z.infer<S> | null => {
  const parsed = schema.safeParse(props)
  return parsed.success ? parsed.data : null
}

const messageIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'chat_message_accepted') return [counter('message_accepted')]
  if (name === 'auth_checked') {
    const p = parseWith(propsByEventName.auth_checked, event.props)
    return p === null ? [] : [counter(p.outcome === 'granted' ? 'auth_granted' : 'auth_denied')]
  }
  if (name === 'turn_started') {
    const p = parseWith(propsByEventName.turn_started, event.props)
    return p === null ? [] : [counter('turn_started'), histogram('queue_delay_ms', p.queue_wait_ms)]
  }
  if (name === 'turn_completed') {
    const p = parseWith(propsByEventName.turn_completed, event.props)
    if (p === null) return []
    return [
      counter(p.outcome === 'ok' ? 'turn_completed' : 'turn_failed'),
      histogram('turn_duration_ms', p.duration_ms),
    ]
  }
  if (name === 'reply_sent') {
    const p = parseWith(propsByEventName.reply_sent, event.props)
    return p === null ? [] : [histogram('time_to_first_reply_ms', p.latency_ms)]
  }
  return null
}

const executionIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'llm_started') return [counter('llm_started')]
  if (name === 'llm_failed') return [counter('llm_failed')]
  if (name === 'tool_started') return [counter('tool_started')]
  if (name === 'llm_completed') {
    const p = parseWith(propsByEventName.llm_completed, event.props)
    if (p === null) return []
    return p.time_to_first_token_ms === null
      ? [counter('llm_completed')]
      : [counter('llm_completed'), histogram('time_to_first_token_ms', p.time_to_first_token_ms)]
  }
  if (name === 'tool_completed') {
    const p = parseWith(propsByEventName.tool_completed, event.props)
    if (p === null) return []
    return [
      counter(p.execution_outcome === 'semantic_success' ? 'tool_semantic_success' : 'tool_failed'),
      histogram('tool_duration_ms', p.duration_ms),
    ]
  }
  if (name === 'confirmation_resolved') {
    const p = parseWith(propsByEventName.confirmation_resolved, event.props)
    return p === null ? [] : [histogram('confirmation_latency_ms', p.decision_latency_ms)]
  }
  if (name === 'first_visible_feedback') {
    const p = parseWith(propsByEventName.first_visible_feedback, event.props)
    if (p === null || p.latency_ms === null) return []
    return [histogram('first_feedback_ms', p.latency_ms)]
  }
  return null
}

const boundaryIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'rate_limit_blocked') return [counter('rate_limit_blocked')]
  if (name === 'unconfigured_reply') return [counter('unconfigured_reply')]
  if (name === 'provider_request_completed') {
    const p = parseWith(propsByEventName.provider_request_completed, event.props)
    if (p === null || p.outcome !== 'failure') return []
    return [counter('provider_failed')]
  }
  if (name === 'mcp_availability') {
    const p = parseWith(propsByEventName.mcp_availability, event.props)
    if (p === null || p.outcome === 'available') return []
    return [counter('mcp_unavailable')]
  }
  return null
}

const derivedIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  if (event.event.name !== 'guest_turn_aggregate') return null
  const p = parseWith(propsByEventName.guest_turn_aggregate, event.props)
  return p === null ? [] : [counter('guest_turn', p.turns)]
}

const editIncrements = (event: AnalyticsEventV1): readonly AggregateIncrement[] | null => {
  const name = event.event.name
  if (name === 'edit_classified') {
    const p = parseWith(propsByEventName.edit_classified, event.props)
    if (p === null) return []
    return [
      counter(
        p.window === 'w1' ? 'edit_classified_w1' : p.window === 'w2' ? 'edit_classified_w2' : 'edit_classified_w3',
      ),
    ]
  }
  if (name === 'edit_regen') {
    const p = parseWith(propsByEventName.edit_regen, event.props)
    if (p === null) return []
    if (p.phase === 'prompt_shown') return [counter('edit_prompt_shown')]
    if (p.phase === 'prompt_adjust') return [counter('edit_prompt_adjust')]
    if (p.phase === 'prompt_note') return [counter('edit_prompt_note')]
    if (p.phase === 'regen_started') return [counter('edit_regen_started')]
    if (p.phase === 'regen_completed') return [counter('edit_regen_completed')]
    if (p.phase === 'regen_failed') return [counter('edit_regen_failed')]
    return [counter('edit_history_only')]
  }
  return null
}

export const incrementsForEvent = (event: AnalyticsEventV1): readonly AggregateIncrement[] =>
  messageIncrements(event) ??
  executionIncrements(event) ??
  boundaryIncrements(event) ??
  derivedIncrements(event) ??
  editIncrements(event) ??
  []
