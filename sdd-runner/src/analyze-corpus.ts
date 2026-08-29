// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  classChurn,
  concernPersistence,
  duplicateIdRate,
  lensOverlapRate,
  r2EligibilityRate,
  resolverActionMix,
} from './analyze-findings.js'
import type { R2Eligibility, ResolverActionMix } from './analyze-findings.js'
import { decisionConsistency, gateForensics } from './analyze-gates.js'
import type { DecisionConsistency, GateForensics } from './analyze-gates.js'
import type { RunBundle } from './analyze-io.js'
import type { ChangeGroundTruth } from './analyze-truth.js'
import { retryTaxonomy, trajectoryMetric } from './analyze.js'
import type { Metric, RetryTaxonomy } from './analyze.js'
import type { AgentUsage, SddEvent } from './events.js'
import type { DigestRecord } from './replay.js'
import { EMPTY_USAGE, plusUsage, repriceEvents } from './usage-aggregate.js'
import type { ResolveCostFn } from './usage-aggregate.js'

/**
 * Corpus assembly (D1): per-run analysis = the named metrics + consistency
 * audit + per-role usage through the existing reprice seam; the corpus
 * aggregate is a reduce over per-run results that excludes era-contaminated
 * runs so dev-era signatures do not silently skew the pooled numbers.
 */

export interface RunUsage {
  readonly byRole: Readonly<Record<string, AgentUsage>>
  readonly costKnown: boolean
}

function usageOf(events: readonly SddEvent[], resolveCost: ResolveCostFn): RunUsage {
  const roleOf = new Map<string, string>()
  for (const event of events) {
    if (event.type === 'spawned') roleOf.set(event.agent, event.role)
  }
  const { events: repriced, costKnown } = repriceEvents(events, resolveCost)
  const byRole: Record<string, AgentUsage> = {}
  for (const event of repriced) {
    if (event.type !== 'done') continue
    const role = roleOf.get(event.agent) ?? event.agent
    byRole[role] = plusUsage(byRole[role] ?? EMPTY_USAGE, event.usage)
  }
  return { byRole, costKnown }
}

export interface RunAnalysis {
  readonly workDir: string
  readonly runId: string
  readonly changeName: string | null
  readonly status: string | null
  readonly eraContaminated: boolean
  readonly trajectory: Metric<readonly DigestRecord[]>
  readonly gates: Metric<GateForensics>
  readonly retries: Metric<RetryTaxonomy>
  readonly duplicateIdRate: Metric<number>
  readonly lensOverlapRate: Metric<number>
  readonly classChurn: Metric<number>
  readonly resolverActionMix: Metric<ResolverActionMix>
  readonly concernPersistence: Metric<number>
  readonly r2Eligibility: Metric<R2Eligibility>
  readonly consistency: DecisionConsistency
  readonly usage: RunUsage
}

export function analyzeRun(bundle: RunBundle, now: Date, resolveCost: ResolveCostFn): RunAnalysis {
  const consistency = decisionConsistency(bundle)
  return {
    workDir: bundle.workDir,
    runId: bundle.runId,
    changeName: bundle.state?.changeName ?? null,
    status: bundle.state?.status ?? null,
    eraContaminated: consistency.eraContaminated,
    trajectory: trajectoryMetric(bundle),
    gates: gateForensics(bundle, now),
    retries: retryTaxonomy(bundle),
    duplicateIdRate: duplicateIdRate(bundle),
    lensOverlapRate: lensOverlapRate(bundle),
    classChurn: classChurn(bundle),
    resolverActionMix: resolverActionMix(bundle),
    concernPersistence: concernPersistence(bundle),
    r2Eligibility: r2EligibilityRate(bundle),
    consistency,
    usage: usageOf(bundle.events, resolveCost),
  }
}

export interface CorpusAggregates {
  readonly runsAggregated: number
  readonly eraContaminated: readonly string[]
  readonly autoDecisionsByRule: Readonly<Record<string, number>>
  readonly duplicateResolutionEntries: number
  readonly r2Eligibility: R2Eligibility | null
  readonly gatesNeverAnswered: number
  readonly strandedComplete: readonly string[]
  readonly mergedUnimplemented: readonly string[]
}

export interface CorpusReport {
  readonly generatedAt: string
  readonly workdirs: readonly string[]
  readonly runs: readonly RunAnalysis[]
  readonly groundTruth: readonly ChangeGroundTruth[]
  readonly aggregates: CorpusAggregates
}

export interface CorpusOptions {
  readonly now: Date
  readonly resolveCost?: ResolveCostFn
}

export function buildCorpusReport(
  bundles: readonly RunBundle[],
  groundTruth: readonly ChangeGroundTruth[],
  options: CorpusOptions,
): CorpusReport {
  const resolveCost: ResolveCostFn = options.resolveCost ?? ((): null => null)
  const runs = bundles.map((bundle) => analyzeRun(bundle, options.now, resolveCost))
  const clean = runs.filter((run) => !run.eraContaminated)
  const autoDecisionsByRule: Record<string, number> = {}
  for (const run of clean) {
    if (run.gates.status !== 'known') continue
    for (const [rule, count] of Object.entries(run.gates.value.autoDecisionsByRule)) {
      autoDecisionsByRule[rule] = (autoDecisionsByRule[rule] ?? 0) + count
    }
  }
  const r2Parts = clean.flatMap((run) => (run.r2Eligibility.status === 'known' ? [run.r2Eligibility.value] : []))
  const r2Eligibility: R2Eligibility | null =
    r2Parts.length === 0
      ? null
      : {
          eligible: r2Parts.reduce((acc, part) => acc + part.eligible, 0),
          gateStates: r2Parts.reduce((acc, part) => acc + part.gateStates, 0),
        }
  return {
    generatedAt: options.now.toISOString(),
    workdirs: [...new Set(bundles.map((bundle) => bundle.workDir))],
    runs,
    groundTruth,
    aggregates: {
      runsAggregated: clean.length,
      eraContaminated: runs.filter((run) => run.eraContaminated).map((run) => run.runId),
      autoDecisionsByRule,
      duplicateResolutionEntries: clean.reduce((acc, run) => {
        const bundle = bundles.find((candidate) => candidate.runId === run.runId)
        if (bundle === undefined) return acc
        const entries = bundle.resolutions.flatMap((round) => round.items.map((item) => item.id))
        return acc + (entries.length - new Set(entries).size)
      }, 0),
      r2Eligibility,
      gatesNeverAnswered: clean.reduce(
        (acc, run) => acc + (run.gates.status === 'known' ? run.gates.value.neverAnswered.length : 0),
        0,
      ),
      strandedComplete: groundTruth.filter((change) => change.strandedComplete).map((change) => change.changeName),
      mergedUnimplemented: groundTruth
        .filter((change) => change.mergedUnimplemented)
        .map((change) => change.changeName),
    },
  }
}
