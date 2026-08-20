// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev

import { agentWritePath, runAgent } from './agent-runner.js'
import { clusterRecords } from './issue-clustering.js'
import { recordNeedsHuman, recordVerify, saveIssueLedger } from './issue-ledger.js'
import type { LedgerIssueRecord } from './issue-ledger.js'
import type { IssueProcessorDeps } from './issue-processor.js'
import { FixerResultSchema } from './issue-schema.js'
import { emitFixComplete } from './loop-trace.js'
import { emitDecision } from './progress-log.js'
import {
  exposureKind,
  tallyDecision,
  tallyExposure,
  tallyFixerSeverity,
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

function applyBatchSuccess(
  cluster: { records: LedgerIssueRecord[] },
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  fixerResult: import('./issue-schema.js').FixerResult,
): void {
  for (const record of cluster.records) {
    recordVerify(deps.ledger, deps.trace, round, record, fixerResult)
    tallyDecision(collector, fixerResult.verdict, fixerResult.fixed)
    tallyFixerSeverity(collector, fixerResult.severity)
    tallyExposure(collector, exposureKind(record.issue.exposure), exposureKind(fixerResult.exposure))
    emitDecision(deps.log, record, fixerResult.verdict)
    emitFixComplete(deps.trace, round, record.id, fixerResult.fixed, null, 1)
  }
}

function applyBatchFailure(
  cluster: { records: LedgerIssueRecord[] },
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  msg: string,
): void {
  const fb: import('./issue-schema.js').FixerResult = {
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

async function runOneBatch(
  cluster: { id: string; records: LedgerIssueRecord[] },
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
): Promise<boolean> {
  const worker = await deps.pool.acquire(cluster.records[0]!.issue.file)
  let batchFixed = false
  try {
    const outputPath = workerOutputPath(deps.runState.runDir, worker.id, `batch-${cluster.id}.json`)
    const prompt = buildClusterFixPrompt(
      cluster.records,
      agentWritePath(worker.worktreePath, outputPath),
      deps.config.checkCommand,
    )
    const result = await runAgent({
      spawn: deps.spawn,
      model: deps.config.fixer.model,
      cwd: worker.worktreePath,
      prompt,
      outputPath,
      outputSchema: FixerResultSchema,
      label: `fixer-batch-${cluster.id}`,
      reporter: deps.log,
      logPath: deps.runState.logPath,
      extraArgs: deps.config.fixer.extraArgs,
      timeoutMs: deps.config.fixer.timeoutMs ?? deps.config.agentTimeoutMs,
    })
    const fixerResult = result.value
    applyBatchSuccess(cluster, deps, round, collector, fixerResult)
    batchFixed = fixerResult.fixed && fixerResult.verdict === 'valid'
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    applyBatchFailure(cluster, deps, round, collector, msg)
  } finally {
    deps.pool.release(worker)
  }
  return batchFixed
}

export async function processBatched(
  deps: IssueProcessorDeps,
  round: number,
  collector: RoundCollector,
  pending: readonly LedgerIssueRecord[],
): Promise<number> {
  const clusters = clusterRecords(pending)
  let fixedBatches = 0
  let chain: Promise<void> = Promise.resolve()
  const batchResults: Promise<boolean>[] = []
  for (const cluster of clusters) {
    if ((deps.stop?.requested() ?? null) !== null) break
    const p: Promise<boolean> = chain.then(() => runOneBatch(cluster, deps, round, collector))
    batchResults.push(p)
    chain = p.then(
      () => undefined,
      () => undefined,
    )
  }
  const results = await Promise.all(batchResults)
  for (const r of results) if (r) fixedBatches += 1
  try {
    const save = deps.saveLedger ?? saveIssueLedger
    await save(deps.ledger)
  } catch {
    // best-effort final save
  }
  return fixedBatches
}
