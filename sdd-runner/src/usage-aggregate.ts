// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentUsage, DoneEvent, SddEvent } from './events.js'
import type { ResolvedCost } from './pricing.js'

const TOKEN_SCALE = 1_000_000

export type ResolveCostFn = (modelId: string) => ResolvedCost | null

export interface AggregateUsage extends AgentUsage {
  readonly costKnown: boolean
}

export function repriceEvent(
  event: DoneEvent,
  cost: { input: number; output: number; cache_read?: number; cache_write?: number },
): DoneEvent {
  if (event.usage.costUsd > 0) return event
  const { inputTokens, outputTokens, reasoningTokens, cachedReadTokens, cachedWriteTokens } = event.usage
  if (
    inputTokens === 0 &&
    outputTokens === 0 &&
    reasoningTokens === 0 &&
    cachedReadTokens === 0 &&
    cachedWriteTokens === 0
  ) {
    return event
  }
  const cacheReadCost = (cachedReadTokens / TOKEN_SCALE) * (cost.cache_read ?? 0)
  const cacheWriteCost = (cachedWriteTokens / TOKEN_SCALE) * (cost.cache_write ?? 0)
  const costUsd =
    ((inputTokens + reasoningTokens) * cost.input + outputTokens * cost.output) / TOKEN_SCALE +
    cacheReadCost +
    cacheWriteCost
  return { ...event, usage: { ...event.usage, costUsd } }
}

export function repriceEvents(
  events: readonly SddEvent[],
  resolve: ResolveCostFn = () => null,
): { events: SddEvent[]; costKnown: boolean } {
  const agentModel = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'spawned') agentModel.set(event.agent, event.model)
  }
  let costKnown = true
  const out = events.map((event): SddEvent => {
    if (event.type !== 'done') return event
    if (event.usage.costUsd > 0) return event
    const { inputTokens, outputTokens, reasoningTokens, cachedReadTokens, cachedWriteTokens } = event.usage
    if (
      inputTokens === 0 &&
      outputTokens === 0 &&
      reasoningTokens === 0 &&
      cachedReadTokens === 0 &&
      cachedWriteTokens === 0
    ) {
      return event
    }
    const model = event.model ?? agentModel.get(event.agent)
    if (model === undefined) {
      costKnown = false
      return event
    }
    const resolved = resolve(model)
    if (resolved === null) {
      costKnown = false
      return event
    }
    if (resolved.source === 'fallback') costKnown = false
    return repriceEvent(
      { ...event, model },
      {
        input: resolved.input,
        output: resolved.output,
        cache_read: resolved.cache_read,
        cache_write: resolved.cache_write,
      },
    )
  })
  return { events: out, costKnown }
}

export function aggregateUsage(events: readonly SddEvent[], resolve: ResolveCostFn = () => null): AggregateUsage {
  const { events: repriced, costKnown } = repriceEvents(events, resolve)
  const usage = repriced.reduce<AgentUsage>(
    (acc, event) => {
      if (event.type !== 'done') return acc
      return {
        inputTokens: acc.inputTokens + event.usage.inputTokens,
        outputTokens: acc.outputTokens + event.usage.outputTokens,
        reasoningTokens: acc.reasoningTokens + event.usage.reasoningTokens,
        cachedReadTokens: acc.cachedReadTokens + event.usage.cachedReadTokens,
        cachedWriteTokens: acc.cachedWriteTokens + event.usage.cachedWriteTokens,
        costUsd: acc.costUsd + event.usage.costUsd,
        wallMs: acc.wallMs + event.usage.wallMs,
      }
    },
    {
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cachedReadTokens: 0,
      cachedWriteTokens: 0,
      costUsd: 0,
      wallMs: 0,
    },
  )
  return { ...usage, costKnown }
}
