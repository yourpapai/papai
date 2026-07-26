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

import { getPolicy } from '../src/analytics/governance/policy-store.js'
import { runBackfillCli } from '../src/analytics/jobs/backfill-cli.js'
import type { BackfillCliArgs } from '../src/analytics/jobs/backfill-cli.js'
import type { BackfillSource } from '../src/analytics/jobs/backfill.js'
import { getDrizzleDb, closeDrizzleDb } from '../src/db/drizzle.js'

type CliArgs = BackfillCliArgs

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

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  const result = runBackfillCli(args, {
    getDrizzleDb,
    env: process.env,
    nowMs: Date.now(),
    getPolicy: () => getPolicy(),
  })
  for (const line of result.lines) {
    if (result.error) console.error(line)
    else console.log(line)
  }
  if (result.exitCode !== 0) process.exit(result.exitCode)
}

try {
  main()
} catch {
  fail('internal')
} finally {
  closeDrizzleDb()
}
