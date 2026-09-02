// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  classChurn,
  concernPersistence,
  duplicateIdRate,
  lensOverlapRate,
  R2_CAUSES,
  r2EligibilityRate,
  resolverActionMix,
} from './analyze-findings.js'
import type { R2Cause, R2CauseMix, R2Eligibility, ResolverActionMix } from './analyze-findings.js'
import { decisionConsistency, gateForensics } from './analyze-gates.js'
import type { DecisionConsistency, GateForensics } from './analyze-gates.js'
import type { RunBundle } from './analyze-io.js'
import type { ChangeGroundTruth } from './analyze-truth.js'
import { usageOf } from './analyze-usage.js'
import type { RunUsage } from './analyze-usage.js'
import { retryTaxonomy, stageFailureTaxonomy, trajectoryMetric } from './analyze.js'
import type { Metric, RetryTaxonomy, StageFailureTaxonomy } from './analyze.js'
import type { DigestRecord } from './legacy-fold.js'

/**
 * Corpus assembly (D1): per-run analysis = the named metrics + consistency
 * audit + usage fold; the corpus aggregate is a reduce over per-run results
 * that excludes era-contaminated runs so dev-era signatures do not silently
 * skew the pooled numbers.
 */

export interface RunAnalysis {
  readonly workDir: string
  readonly runId: string
  readonly changeName: string | null
  readonly status: string | null
  readonly eraContaminated: boolean
  readonly trajectory: Metric<readonly DigestRecord[]>
  readonly gates: Metric<GateForensics>
  readonly retries: Metric<RetryTaxonomy>
  readonly stageFailures: Metric<StageFailureTaxonomy>
  readonly duplicateIdRate: Metric<number>
  readonly lensOverlapRate: Metric<number>
  readonly classChurn: Metric<number>
  readonly resolverActionMix: Metric<ResolverActionMix>
  readonly concernPersistence: Metric<number>
  readonly r2Eligibility: Metric<R2Eligibility>
  readonly consistency: DecisionConsistency
  readonly usage: RunUsage
}

export function analyzeRun(bundle: RunBundle, now: Date): RunAnalysis {
  const consistency = decisionConsistency(bundle)
  const usage = usageOf(bundle.events)
  return {
    workDir: bundle.workDir,
    runId: bundle.runId,
    changeName: bundle.state?.changeName ?? null,
    status: bundle.state?.status ?? null,
    eraContaminated: consistency.eraContaminated,
    trajectory: trajectoryMetric(bundle),
    gates: gateForensics(bundle, now),
    retries: retryTaxonomy(bundle),
    stageFailures: stageFailureTaxonomy(bundle),
    duplicateIdRate: duplicateIdRate(bundle),
    lensOverlapRate: lensOverlapRate(bundle),
    classChurn: classChurn(bundle),
    resolverActionMix: resolverActionMix(bundle),
    concernPersistence: concernPersistence(bundle),
    r2Eligibility: r2EligibilityRate(bundle, usage.costKnown),
    consistency,
    usage,
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
}

/** Within-round duplicate ledger entries per bundle (the dead-dedup count). */
function duplicateEntriesOf(bundle: RunBundle): number {
  return bundle.resolutions.reduce(
    (acc, round) => acc + (round.items.length - new Set(round.items.map((item) => item.id)).size),
    0,
  )
}

/** Per-cause sums across runs with a known metric, fixed cause order, nonzero entries only. */
function r2CauseMixOf(parts: readonly R2Eligibility[]): R2CauseMix {
  const mix: Partial<Record<R2Cause, number>> = {}
  for (const cause of R2_CAUSES) {
    const total = parts.reduce((acc, part) => acc + (part.byCause[cause] ?? 0), 0)
    if (total > 0) mix[cause] = total
  }
  return mix
}

function aggregatesOf(
  bundles: readonly RunBundle[],
  runs: readonly RunAnalysis[],
  groundTruth: readonly ChangeGroundTruth[],
): CorpusAggregates {
  const clean = runs.filter((run) => !run.eraContaminated)
  const autoDecisionsByRule: Record<string, number> = {}
  for (const run of clean) {
    if (run.gates.status !== 'known') continue
    for (const [rule, count] of Object.entries(run.gates.value.autoDecisionsByRule)) {
      autoDecisionsByRule[rule] = (autoDecisionsByRule[rule] ?? 0) + count
    }
  }
  const r2Parts = clean.flatMap((run) => (run.r2Eligibility.status === 'known' ? [run.r2Eligibility.value] : []))
  return {
    runsAggregated: clean.length,
    eraContaminated: runs.filter((run) => run.eraContaminated).map((run) => run.runId),
    autoDecisionsByRule,
    duplicateResolutionEntries: clean.reduce((acc, run) => {
      const bundle = bundles.find((candidate) => candidate.runId === run.runId && candidate.workDir === run.workDir)
      return bundle === undefined ? acc : acc + duplicateEntriesOf(bundle)
    }, 0),
    r2Eligibility:
      r2Parts.length === 0
        ? null
        : {
            eligible: r2Parts.reduce((acc, part) => acc + part.eligible, 0),
            gateStates: r2Parts.reduce((acc, part) => acc + part.gateStates, 0),
            byCause: r2CauseMixOf(r2Parts),
          },
    gatesNeverAnswered: clean.reduce(
      (acc, run) => acc + (run.gates.status === 'known' ? run.gates.value.neverAnswered.length : 0),
      0,
    ),
    strandedComplete: groundTruth.filter((change) => change.strandedComplete).map((change) => change.changeName),
    mergedUnimplemented: groundTruth.filter((change) => change.mergedUnimplemented).map((change) => change.changeName),
  }
}

export function buildCorpusReport(
  bundles: readonly RunBundle[],
  groundTruth: readonly ChangeGroundTruth[],
  options: CorpusOptions,
): CorpusReport {
  const runs = bundles.map((bundle) => analyzeRun(bundle, options.now))
  return {
    generatedAt: options.now.toISOString(),
    workdirs: [...new Set(bundles.map((bundle) => bundle.workDir))],
    runs,
    groundTruth,
    aggregates: aggregatesOf(bundles, runs, groundTruth),
  }
}
