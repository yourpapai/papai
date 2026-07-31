// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import type { AnalyticsPolicyRow } from '../../db/schema.js'
import { ANALYTICS_HMAC_KEYRING_ENV } from '../config.js'
import { parseAnalyticsKeyring } from '../identity/keyring.js'
import { runBackfillJob } from './backfill.js'
import type { BackfillJobInput, BackfillRunSummary, BackfillSource } from './backfill.js'
import { runReconciliation } from './reconcile.js'

export const BACKFILL_APPROVAL_ENV = 'ANALYTICS_BACKFILL_APPROVED_AT_MS'

export type BackfillCliArgs = Readonly<{
  dryRun: boolean
  batchSize: number
  resume: boolean
  source: BackfillSource
  reconcile: boolean
}>

export type BackfillCliDeps = Readonly<{
  getDrizzleDb: typeof defaultGetDrizzleDb
  env: Readonly<Record<string, string | undefined>>
  nowMs: number
  getPolicy: () => AnalyticsPolicyRow
}>

export type BackfillCliResult = Readonly<{
  exitCode: number
  error: boolean
  lines: readonly string[]
}>

type CutoffResolution =
  | Readonly<{ kind: 'resolved'; cutoffMs: number }>
  | Readonly<{ kind: 'refused'; reason: 'approval_unavailable' | 'approval_required' }>

const resolveBackfillCutoff = (
  env: Readonly<Record<string, string | undefined>>,
  getPolicy: () => AnalyticsPolicyRow,
): CutoffResolution => {
  let policy: AnalyticsPolicyRow
  try {
    policy = getPolicy()
  } catch {
    return { kind: 'refused', reason: 'approval_unavailable' }
  }
  if (policy.lawfulBasisMode === 'legitimate_interest') {
    const raw = env[BACKFILL_APPROVAL_ENV]
    const approvedAtMs = raw === undefined ? NaN : Number(raw)
    if (!Number.isSafeInteger(approvedAtMs) || approvedAtMs < 0) {
      return { kind: 'refused', reason: 'approval_required' }
    }
    return { kind: 'resolved', cutoffMs: approvedAtMs }
  }
  return { kind: 'resolved', cutoffMs: policy.policyEffectiveAtMs ?? 0 }
}

const errorResult = (reason: string): BackfillCliResult => ({
  exitCode: 1,
  error: true,
  lines: [`status=error reason=${reason}`],
})

const runLine = (run: BackfillRunSummary): string => {
  const d = run.decisions
  return (
    `run=${run.runId} source=${run.sourceTable} status=${run.status} ` +
    `high_water=${run.highWaterKeyHash ?? 'none'} scanned=${run.scanned} ` +
    `canonical=${d.canonical} aggregate_only=${d.aggregateOnly} ineligible=${d.ineligible} rejected=${d.rejected} ` +
    `applied=${run.applied} skipped=${run.skipped}`
  )
}

const reconcileLines = (deps: BackfillCliDeps): Readonly<{ lines: readonly string[]; delta: boolean }> => {
  const report = runReconciliation({ nowMs: deps.nowMs, apply: true }, { getDrizzleDb: deps.getDrizzleDb })
  const gapEpochs = report.liveEpochs.filter((epoch) => epoch.status === 'unreconciled_restart_gap').length
  const publishableEpochs = report.liveEpochs.filter((epoch) => epoch.status === 'publishable').length
  return {
    lines: [
      `reconciliation status=${report.status} unexplained_delta=${report.durableUsage.unexplainedDeltaTotal} ` +
        `gap_epochs=${gapEpochs} publishable_epochs=${publishableEpochs} delivery_total=${report.delivery.total}`,
    ],
    delta: report.status === 'delta',
  }
}

export const runBackfillCli = (args: BackfillCliArgs, deps: BackfillCliDeps): BackfillCliResult => {
  const keyring = parseAnalyticsKeyring(deps.env[ANALYTICS_HMAC_KEYRING_ENV])
  if (keyring.kind !== 'available') return errorResult('keyring_unavailable')
  const cutoff = resolveBackfillCutoff(deps.env, deps.getPolicy)
  if (cutoff.kind === 'refused') return errorResult(cutoff.reason)
  const input: BackfillJobInput = {
    source: args.source,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    resume: args.resume,
    cutoffMs: cutoff.cutoffMs,
    key: keyring.activeKey,
    keyVersion: keyring.activeVersion,
    nowMs: deps.nowMs,
  }
  const result = runBackfillJob(input, { getDrizzleDb: deps.getDrizzleDb })
  const lines = result.runs.map(runLine)
  if (result.runs.some((run) => run.status === 'failed' || run.status === 'requires_resume')) {
    return { exitCode: 1, error: false, lines }
  }
  if (args.reconcile && !args.dryRun) {
    const reconciliation = reconcileLines(deps)
    return { exitCode: reconciliation.delta ? 1 : 0, error: false, lines: [...lines, ...reconciliation.lines] }
  }
  return { exitCode: 0, error: false, lines }
}
