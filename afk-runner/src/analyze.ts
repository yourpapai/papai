// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RunBundle } from './analyze-io.js'
import type { FailureKind, SddEvent } from './events.js'
import { pipelineMachine } from './graph/pipeline.js'
import { foldEvents } from './kernel/fold.js'
import type { DigestRecord } from './legacy-fold.js'

/**
 * Per-run analysis metrics (D1/D3): pure functions over the kernel-folded
 * event log and sidecar joins — named after the forensics they replace.
 * Every metric reports either a value or an explicit unknown with its
 * reason, so pre-change runs (older vocabularies, missing sidecars) parse
 * to reduced coverage instead of failing. The fold is the one live engine —
 * `foldEvents(pipelineMachine, …)`, never `legacy-fold` (the frozen parity
 * oracle must keep judging the engine, not be consumed beside it). Gate
 * forensics and the consistency audit live in `analyze-gates.ts`;
 * finding-lifecycle metrics in `analyze-findings.ts`.
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

/** The kernel fold over a bundle's events — the one engine analysis shares with the drive loop. */
export function foldOf(events: readonly SddEvent[]): ReturnType<typeof foldEvents> {
  return foldEvents(pipelineMachine, events)
}

export function trajectoryMetric(bundle: RunBundle): Metric<readonly DigestRecord[]> {
  const { snapshot } = foldOf(bundle.events)
  if (snapshot.context.perRound.length === 0) return unknownMetric('no convergence records')
  return knownMetric(snapshot.context.perRound)
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

export type StageFailureTaxonomy = Readonly<Record<string, Readonly<Record<FailureKind, number>>>>

/** Declared `stage_failed` events by stage and kind (C6's failure vocabulary). */
export function stageFailureTaxonomy(bundle: RunBundle): Metric<StageFailureTaxonomy> {
  if (bundle.events.length === 0) return unknownMetric('no event log')
  const byStage: Record<string, Record<FailureKind, number>> = {}
  for (const event of bundle.events) {
    if (event.type !== 'stage_failed') continue
    const counts = byStage[event.stage] ?? { exhausted: 0, precondition: 0, infra: 0 }
    counts[event.kind] += 1
    byStage[event.stage] = counts
  }
  return knownMetric(byStage)
}
