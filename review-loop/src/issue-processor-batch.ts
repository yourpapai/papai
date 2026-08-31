// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { agentWritePath, runAgent } from './agent-runner.js'
import { medianOf, shouldDeferBatch } from './batch-defer.js'
import { claimedFilesOf, type BatchMember, type FixedBatch } from './batch-outcomes.js'
import { verifyAndMergeBatches } from './batch-verify.js'
import { clusterRecords } from './issue-clustering.js'
import { recordNeedsHuman, recordVerify, saveIssueLedger, type LedgerIssueRecord } from './issue-ledger.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { ClusterFixerResultSchema, type FixerResult } from './issue-schema.js'
import { emitFixComplete } from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import {
  exposureKind,
  tallyDecision,
  tallyExposure,
  tallyFixerSeverity,
  tallyPhaseMs,
  tallyUsage,
  type RoundCollector,
} from './round-collector.js'
import { workerOutputPath } from './run-state.js'

function buildClusterFixPrompt(
  records: readonly LedgerIssueRecord[],
  outputPath: string,
  checkCommand: string,
): string {
  const issues = records.map((r) => ({ id: r.id, issue: r.issue }))
  return [
    `Fix the following ${records.length} issues together. They share a theme (batched).`,
    `Edit only what is necessary; do not commit. After fixing, run \`${checkCommand}\` is deferred to round-level verification — do not run it now.`,
    `Write your result as JSON to: ${outputPath}`,
    'Use this exact schema (one result per issue): {"results": [{"id": string, "verdict": "valid"|"invalid"|"already_fixed"|"needs_human"|"plan_drift", "fixability": "auto"|"manual", "reasoning": string, "targetFiles": string[], "fixed": boolean}]}',
    'Issues:',
    JSON.stringify(issues, null, 2),
  ].join('\n\n')
}

function applyBatchFailure(
  cluster: { records: LedgerIssueRecord[] },
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  msg: string,
): void {
  const fb: FixerResult = {
    verdict: 'needs_human',
    fixability: 'manual',
    reasoning: `batch failed: ${msg}`,
    targetFiles: [],
    fixed: false,
  }
  for (const record of cluster.records) {
    recordNeedsHuman(deps.ledger, deps.trace, round, record, `batch failed: ${msg}`, fb)
    tallyDecision(collector, 'needs_human', false)
    emitDecision(deps.log, record, 'needs_human', `batch failed: ${msg}`)
    emitFixComplete(deps.trace, round, record.id, false, null, 1)
  }
}

const omittedMemberResult = (id: string): FixerResult => ({
  verdict: 'needs_human',
  fixability: 'manual',
  reasoning: `batch fixer omitted member ${id} from its result`,
  targetFiles: [],
  fixed: false,
})

/** Records one fixer result and the tallies every decided member owes; returns it for batching when claimed fixed. */
function settleMember(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  record: LedgerIssueRecord,
  fixerResult: FixerResult,
): BatchMember | null {
  recordVerify(deps.ledger, deps.trace, round, record, fixerResult)
  if (fixerResult.fixed && fixerResult.verdict === 'valid') return { record, fixerResult }
  tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
  tallyFixerSeverity(collector, fixerResult.severity)
  tallyExposure(collector, exposureKind(record.issue.exposure), exposureKind(fixerResult.exposure))
  emitDecision(deps.log, record, fixerResult.verdict)
  emitFixComplete(deps.trace, round, record.id, false, null, 1)
  return null
}

/**
 * One fixer run over one cluster. Members the fixer did not settle (`fixed`
 * false or a non-`valid` verdict) are decided here; claimed-fixed members are
 * returned for the round-level verification phase, which owns their outcome.
 */
async function runOneBatch(
  cluster: { id: string; records: LedgerIssueRecord[] },
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
): Promise<FixedBatch | null> {
  const worker = await deps.pool.acquire(cluster.records[0]!.issue.file)
  try {
    const outputPath = workerOutputPath(deps.runState.runDir, worker.id, `batch-${cluster.id}.json`)
    const prompt = buildClusterFixPrompt(
      cluster.records,
      agentWritePath(worker.worktreePath, outputPath),
      deps.config.checkCommand,
    )
    const fixerStart = Date.now()
    const result = await runAgent({
      spawn: deps.spawn,
      model: deps.config.fixer.model,
      effort: deps.config.fixer.effort,
      backend: deps.config.backend,
      claude: deps.config.claude,
      cwd: worker.worktreePath,
      prompt,
      outputPath,
      outputSchema: ClusterFixerResultSchema,
      label: `fixer-batch-${cluster.id}`,
      reporter: deps.log,
      logPath: deps.runState.logPath,
      extraArgs: deps.config.fixer.extraArgs,
      timeoutMs: deps.config.fixer.timeoutMs ?? deps.config.agentTimeoutMs,
    })
    tallyPhaseMs(collector, 'verify', Date.now() - fixerStart)
    tallyUsage(collector, result.usage)

    const byId = new Map(result.value.results.map((r) => [r.id, r] as const))
    const members: BatchMember[] = []
    for (const record of cluster.records) {
      const member = settleMember(deps, round, collector, record, byId.get(record.id) ?? omittedMemberResult(record.id))
      if (member !== null) members.push(member)
    }
    if (members.length === 0) return null
    return { members, claims: claimedFilesOf(members) }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    applyBatchFailure(cluster, deps, round, collector, msg)
    return null
  } finally {
    deps.pool.release(worker)
  }
}

export async function processBatched(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  const clusters = clusterRecords(pending)
  const fixDurations: number[] = []
  const fixedBatches: FixedBatch[] = []
  // Sequential on purpose: `poolSize=1` means every cluster shares one worker,
  // so each fixer starts from the previous batch's uncommitted diff — the
  // aggregated diff the round-level verification phase later judges. The stop
  // and deferral questions are asked inside the chain, at the moment a batch
  // would start, because the answer depends on the batches before it.
  let chain: Promise<unknown> = Promise.resolve()
  for (const cluster of clusters) {
    chain = chain.then((): Promise<unknown> => {
      if ((deps.stop?.requested() ?? null) !== null) return Promise.resolve()
      const remainingMs = deps.stop?.remainingMs?.() ?? Infinity
      if (shouldDeferBatch(cluster.records, remainingMs, medianOf(fixDurations))) {
        collector.deferred += cluster.records.length
        for (const record of cluster.records) {
          emitDecision(deps.log, record, 'deferred', 'budget short; re-considered next round')
        }
        return Promise.resolve()
      }
      const start = Date.now()
      return runOneBatch(cluster, deps, round, collector).then((batch) => {
        fixDurations.push(Date.now() - start)
        if (batch !== null) fixedBatches.push(batch)
      })
    })
  }
  await chain
  const fixed = fixedBatches.length > 0 ? await verifyAndMergeBatches(deps, round, collector, fixedBatches) : 0
  try {
    const save = deps.saveLedger ?? saveIssueLedger
    await save(deps.ledger)
  } catch {
    // best-effort final save
  }
  return fixed
}
