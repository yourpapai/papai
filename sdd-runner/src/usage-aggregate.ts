// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { readEvents } from './events.js'
import type { AgentUsage, DoneEvent, SddEvent } from './events.js'
import { loadDb } from './pricing.js'
import { resolveCost } from './pricing.js'
import type { ResolvedCost } from './pricing.js'

const TOKEN_SCALE = 1_000_000

export const EMPTY_USAGE: AgentUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedReadTokens: 0,
  cachedWriteTokens: 0,
  costUsd: 0,
  wallMs: 0,
}

export type ResolveCostFn = (modelId: string) => ResolvedCost | null

export interface AggregateUsage extends AgentUsage {
  readonly costKnown: boolean
}

/**
 * One turn's token counts, named by quantity rather than by any one caller's
 * record.
 *
 * The neutral spelling is the point: `AgentUsage` calls these `inputTokens` and
 * `cachedReadTokens`, the claude CLI calls them `input_tokens` and
 * `cache_read_input_tokens`, and OpenCode calls them something else again. A
 * shared arithmetic that named either side's fields would make the other side's
 * call read as a conversion.
 *
 * The three optional buckets are optional because a backend may genuinely not
 * report them; each is priced as zero when absent, which is the same answer as
 * a reported zero. A caller that needs to distinguish "reported none" from "did
 * not say" must make that decision before it gets here — this function prices
 * what it is handed.
 */
export interface UsageBuckets {
  readonly input: number
  readonly output: number
  readonly reasoning?: number
  readonly cacheRead?: number
  readonly cacheWrite?: number
}

/** Per-million-token rates, the shape `pricing.ts` publishes. */
type TokenRates = { input: number; output: number; cache_read?: number; cache_write?: number }

/**
 * What a set of token counts costs at a set of published rates.
 *
 * Extracted out of {@link repriceEvent} so `opencode-agent` can price a coding
 * run with the same code that prices a gate here, rather than a second copy of
 * it that would drift. Everything the arithmetic knows lives here: the
 * per-million scale, cache tokens charged at their own rate or not at all, and
 * reasoning tokens charged at the *input* rate — which is a convention rather
 * than an arithmetic fact, and so exactly the kind of thing that must not be
 * re-decided by a second implementation.
 */
export function costOfUsage(buckets: UsageBuckets, cost: TokenRates): number {
  const { input, output, reasoning = 0, cacheRead = 0, cacheWrite = 0 } = buckets
  const cacheReadCost = (cacheRead / TOKEN_SCALE) * (cost.cache_read ?? 0)
  const cacheWriteCost = (cacheWrite / TOKEN_SCALE) * (cost.cache_write ?? 0)
  return ((input + reasoning) * cost.input + output * cost.output) / TOKEN_SCALE + cacheReadCost + cacheWriteCost
}

export function repriceEvent(event: DoneEvent, cost: TokenRates): DoneEvent {
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
  const costUsd = costOfUsage(
    {
      input: inputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
      cacheRead: cachedReadTokens,
      cacheWrite: cachedWriteTokens,
    },
    cost,
  )
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
  const usage = repriced.reduce<AgentUsage>((acc, event) => {
    if (event.type !== 'done') return acc
    return plusUsage(acc, event.usage)
  }, EMPTY_USAGE)
  return { ...usage, costKnown }
}

export async function buildResolveCost(): Promise<ResolveCostFn> {
  try {
    const db = await loadDb()
    return (modelId: string) => resolveCost(modelId, db)
  } catch {
    return () => null
  }
}

export function plusUsage(acc: AgentUsage, add: AgentUsage): AgentUsage {
  return {
    inputTokens: acc.inputTokens + add.inputTokens,
    outputTokens: acc.outputTokens + add.outputTokens,
    reasoningTokens: acc.reasoningTokens + add.reasoningTokens,
    cachedReadTokens: acc.cachedReadTokens + add.cachedReadTokens,
    cachedWriteTokens: acc.cachedWriteTokens + add.cachedWriteTokens,
    costUsd: acc.costUsd + add.costUsd,
    wallMs: acc.wallMs + add.wallMs,
  }
}

interface ChildFlightUsage {
  settled: boolean
  usage: AgentUsage | undefined
}

/**
 * D10 per-flight `child_done` fold: every spawn-to-spawn flight contributes
 * its LAST `child_done` — an outcome flip (a `failed` child the operator
 * later completed and the parent adopted as `done`) supersedes the stale
 * failure-time line instead of double-counting the flight, and a re-spawn
 * (a retried child) opens a fresh flight that spends again. A `child_done`
 * with no preceding `child_spawned` is its own flight; an unsettled spawn
 * contributes nothing yet.
 */
function childDoneFlightsOf(events: readonly SddEvent[]): ChildFlightUsage[] {
  const open = new Map<string, ChildFlightUsage>()
  const closed: ChildFlightUsage[] = []
  for (const event of events) {
    if (event.type === 'child_spawned') {
      const flight = open.get(event.child)
      if (flight !== undefined) closed.push(flight)
      open.set(event.child, { settled: false, usage: undefined })
    } else if (event.type === 'child_done') {
      const flight = open.get(event.child) ?? { settled: false, usage: undefined }
      flight.settled = true
      flight.usage = event.usage
      open.set(event.child, flight)
    }
  }
  return [...closed, ...open.values()]
}

/**
 * A child run's subtree usage (D10 tree shape): the child's own repriced
 * `done` events plus its own per-flight `child_done.usage` — each of those
 * already subtree-shaped by this same rule — so a composite child carries
 * its grandchildren's spend up into the parent's ledger; undefined when
 * unreadable or any component is unpriced — absent usage makes the D10
 * ledger read unknown (fail closed), never $0 headroom.
 */
export function childUsageOf(childRunDir: string, resolve: ResolveCostFn = () => null): AgentUsage | undefined {
  try {
    const { events, costKnown } = repriceEvents(readEvents(path.join(childRunDir, 'events.ndjson')), resolve)
    if (!costKnown) return undefined
    let usage: AgentUsage = EMPTY_USAGE
    for (const event of events) {
      if (event.type === 'done') usage = plusUsage(usage, event.usage)
    }
    for (const flight of childDoneFlightsOf(events)) {
      if (!flight.settled) continue
      if (flight.usage === undefined) return undefined
      usage = plusUsage(usage, flight.usage)
    }
    return usage
  } catch {
    return undefined
  }
}

export function costAndDuration(
  events: readonly SddEvent[],
  createdAt: string,
  now: Date,
  resolve: ResolveCostFn = () => null,
): { costUsd: number; durationMs: number; costKnown: boolean } {
  const usage = aggregateUsage(events, resolve)
  const durationMs = Math.max(0, now.getTime() - new Date(createdAt).getTime())
  return { costUsd: usage.costUsd, durationMs, costKnown: usage.costKnown }
}

export interface TreeSpend {
  readonly spentUsd: number
  readonly costKnown: boolean
}

/**
 * D10 aggregate ledger: `aggregateUsage(done events)` repriced through
 * `resolve`, plus each flight's last `child_done.usage` (see
 * `childDoneFlightsOf` — a superseding outcome flip counts once). Any
 * settled `child_done` without usage — or an unpriceable parent done event —
 * makes the spend unknown — fail closed.
 */
export function treeSpend(events: readonly SddEvent[], resolve: ResolveCostFn = () => null): TreeSpend {
  const own = aggregateUsage(events, resolve)
  let spentUsd = own.costUsd
  let costKnown = own.costKnown
  for (const flight of childDoneFlightsOf(events)) {
    if (!flight.settled) continue
    if (flight.usage === undefined) costKnown = false
    else spentUsd += flight.usage.costUsd
  }
  return { spentUsd, costKnown }
}
