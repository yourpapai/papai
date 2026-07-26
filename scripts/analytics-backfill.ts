// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Governed usage backfill CLI. Normalizes durable llm_usage_events /
 * tool_call_events rows into closed aggregates with provenance, then
 * reconciles. Usage:
 *   bun run scripts/analytics-backfill.ts [--dry-run] [--batch-size N]
 *     [--resume] [--source llm|tool|all] [--reconcile]
 */

import { ANALYTICS_HMAC_KEYRING_ENV } from '../src/analytics/config.js'
import { getPolicy } from '../src/analytics/governance/policy-store.js'
import { parseAnalyticsKeyring } from '../src/analytics/identity/keyring.js'
import { runBackfillJob } from '../src/analytics/jobs/backfill.js'
import type { BackfillJobInput, BackfillSource } from '../src/analytics/jobs/backfill.js'
import { runReconciliation } from '../src/analytics/jobs/reconcile.js'
import { closeDrizzleDb } from '../src/db/drizzle.js'

const APPROVAL_ENV = 'ANALYTICS_BACKFILL_APPROVED_AT_MS'

type CliArgs = Readonly<{
  dryRun: boolean
  batchSize: number
  resume: boolean
  source: BackfillSource
  reconcile: boolean
}>

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

const parseArgs = (argv: readonly string[]): CliArgs => {
  const args = { dryRun: false, batchSize: 100, resume: false, source: 'all' as BackfillSource, reconcile: false }
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === '--dry-run') args.dryRun = true
    else if (flag === '--resume') args.resume = true
    else if (flag === '--reconcile') args.reconcile = true
    else if (flag === '--batch-size') {
      const value = Number(argv[index + 1])
      if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) fail('invalid_batch_size')
      args.batchSize = value
      index += 1
    } else if (flag === '--source') {
      const value = argv[index + 1]
      if (value === 'llm' || value === 'tool' || value === 'all') {
        args.source = value
      } else {
        fail('invalid_source')
      }
      index += 1
    } else {
      fail('unknown_flag')
    }
  }
  return args
}

const resolveCutoffMs = (): number => {
  let policy: ReturnType<typeof getPolicy> | null = null
  try {
    policy = getPolicy()
  } catch {
    return 0
  }
  if (policy.lawfulBasisMode === 'legitimate_interest') {
    const raw = process.env[APPROVAL_ENV]
    const approvedAtMs = raw === undefined ? NaN : Number(raw)
    if (!Number.isSafeInteger(approvedAtMs) || approvedAtMs < 0) fail('approval_required')
    return approvedAtMs
  }
  return policy.policyEffectiveAtMs ?? 0
}

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  const keyring = parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV])
  if (keyring.kind !== 'available') return fail('keyring_unavailable')
  const input: BackfillJobInput = {
    source: args.source,
    batchSize: args.batchSize,
    dryRun: args.dryRun,
    resume: args.resume,
    cutoffMs: resolveCutoffMs(),
    key: keyring.activeKey,
    keyVersion: keyring.activeVersion,
    nowMs: Date.now(),
  }
  const result = runBackfillJob(input)
  let blocked = false
  for (const run of result.runs) {
    const d = run.decisions
    console.log(
      `run=${run.runId} source=${run.sourceTable} status=${run.status} ` +
        `high_water=${run.highWaterKeyHash ?? 'none'} scanned=${run.scanned} ` +
        `canonical=${d.canonical} aggregate_only=${d.aggregateOnly} ineligible=${d.ineligible} rejected=${d.rejected} ` +
        `applied=${run.applied} skipped=${run.skipped}`,
    )
    if (run.status === 'failed' || run.status === 'requires_resume') blocked = true
  }
  if (blocked) process.exit(1)
  if (args.reconcile && !args.dryRun) {
    const report = runReconciliation({ nowMs: Date.now(), apply: true })
    const gapEpochs = report.liveEpochs.filter((epoch) => epoch.status === 'unreconciled_restart_gap').length
    const publishableEpochs = report.liveEpochs.filter((epoch) => epoch.status === 'publishable').length
    console.log(
      `reconciliation status=${report.status} unexplained_delta=${report.durableUsage.unexplainedDeltaTotal} ` +
        `gap_epochs=${gapEpochs} publishable_epochs=${publishableEpochs} delivery_total=${report.delivery.total}`,
    )
    if (report.status === 'delta') process.exit(1)
  }
}

try {
  main()
} catch {
  fail('internal')
} finally {
  closeDrizzleDb()
}
