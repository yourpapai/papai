// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import type { SddEvent } from './events.js'
import type { DigestRecord, ReplayState } from './replay.js'
import { createReplayFolder } from './replay.js'

/**
 * Per-run analysis metrics (D1/D3): pure functions over the replayed event
 * fold and sidecar joins — named after the forensics they replace. Every
 * metric reports either a value or an explicit unknown with its reason, so
 * pre-change runs (older vocabularies, missing sidecars) parse to reduced
 * coverage instead of failing. Gate forensics and the consistency audit live
 * in `analyze-gates.ts`; finding-lifecycle metrics in `analyze-findings.ts`.
 */

export type Metric<T> =
  | { readonly status: 'known'; readonly value: T }
  | { readonly status: 'unknown'; readonly reason: string }

export function knownMetric<T>(value: T): Metric<T> {
  return { status: 'known', value }
}

export function unknownMetric(reason: string): Metric<never> {
  return { status: 'unknown', reason }
}

/** The one fold engine: each metric reuses `replay.ts`'s fold, never a second one. */
export function replayOf(events: readonly SddEvent[]): ReplayState {
  const folder = createReplayFolder()
  for (const event of events) folder.fold(event)
  return folder.state
}

export function trajectoryMetric(bundle: RunBundle): Metric<readonly DigestRecord[]> {
  const replay = replayOf(bundle.events)
  if (replay.perRound.length === 0) return unknownMetric('no convergence records')
  return knownMetric(replay.perRound)
}

export type RetryTaxonomy = Readonly<Record<string, { readonly stall: number; readonly validation: number }>>

export function retryTaxonomy(bundle: RunBundle): Metric<RetryTaxonomy> {
  if (bundle.events.length === 0) return unknownMetric('no event log')
  const roleOf = new Map<string, string>()
  for (const event of bundle.events) {
    if (event.type === 'spawned') roleOf.set(event.agent, event.role)
  }
  const byRole: Record<string, { stall: number; validation: number }> = {}
  for (const event of bundle.events) {
    if (event.type !== 'retrying') continue
    const role = roleOf.get(event.agent) ?? event.agent
    const counts = byRole[role] ?? { stall: 0, validation: 0 }
    counts[event.reason] += 1
    byRole[role] = counts
  }
  return knownMetric(byRole)
}
