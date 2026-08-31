// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AgentUsage, SddEvent } from './events.js'
import { EMPTY_USAGE, plusUsage, tokensOf } from './work/gate-signals.js'

/**
 * The analyzer usage fold (D7 — no pricing DB port): per-role via the
 * `spawned` join and per-round via a `round_open` ts-window (`done` events
 * carry no round). `costKnown` follows `usageTotalsOf` semantics (any done
 * with tokens > 0 and costUsd 0 → unknown) and the unpriced-event count
 * rides along so the report can render cost as a lower bound, the `runs`
 * footer's honesty contract inherited by the corpus report.
 */

export interface RunUsage {
  readonly byRole: Readonly<Record<string, AgentUsage>>
  readonly byRound: Readonly<Record<number, AgentUsage>>
  readonly costKnown: boolean
  readonly unpricedEvents: number
}

export function usageOf(events: readonly SddEvent[]): RunUsage {
  const roleOf = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'spawned') roleOf.set(event.agent, event.role)
  }
  const opens = events
    .filter((event): boolean => event.type === 'round_open')
    .map((event): { readonly round: number; readonly ts: number } => ({
      round: event.type === 'round_open' ? event.round : 0,
      ts: Date.parse(event.ts),
    }))
  const byRole: Record<string, AgentUsage> = {}
  const byRound: Record<number, AgentUsage> = {}
  let costKnown = true
  let unpricedEvents = 0
  for (const event of events) {
    if (event.type !== 'done') continue
    const role = roleOf.get(event.agent) ?? event.agent
    byRole[role] = plusUsage(byRole[role] ?? EMPTY_USAGE, event.usage)
    const round = roundOfOpens(opens, Date.parse(event.ts))
    byRound[round] = plusUsage(byRound[round] ?? EMPTY_USAGE, event.usage)
    if (event.usage.costUsd === 0 && tokensOf(event.usage) > 0) {
      costKnown = false
      unpricedEvents += 1
    }
  }
  return { byRole, byRound, costKnown, unpricedEvents }
}

/** The round whose `round_open` ts ≤ event ts < the next open; 0 before the first round. */
function roundOfOpens(opens: readonly { round: number; ts: number }[], eventTs: number): number {
  let round = 0
  for (const open of opens) {
    if (open.ts <= eventTs) round = open.round
    else break
  }
  return round
}
