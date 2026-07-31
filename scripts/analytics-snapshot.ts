// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Curated analytics snapshot CLI. Builds a fresh-empty allowlisted publish
 * database, byte/schema/freelist-scans it, stages the publication row, and
 * atomically moves it into place. Usage:
 *   bun run scripts/analytics-snapshot.ts --output /abs/snapshot.db [--verify] [--replace] [--aggregate-only]
 * A previously valid snapshot is never overwritten until the fresh output
 * verifies, and only with --replace.
 */

import type { SnapshotMode } from '../src/analytics/jobs/snapshot-schema.js'
import { publishAnalyticsSnapshot, verifySnapshotFile } from '../src/analytics/jobs/snapshot.js'
import { createRekeyCutoverFence } from '../src/analytics/rekey/cutover-fence.js'
import { closeDrizzleDb, getDrizzleDb } from '../src/db/drizzle.js'

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

const parseArgs = (
  argv: readonly string[],
): Readonly<{ outputPath: string; verify: boolean; replace: boolean; mode: SnapshotMode }> => {
  const flags = new Map<string, string>()
  const booleans = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === undefined || !flag.startsWith('--')) throw new Error('unknown_flag')
    if (flag === '--verify' || flag === '--replace' || flag === '--aggregate-only') {
      booleans.add(flag)
      continue
    }
    const value = argv[index + 1]
    if (value === undefined) throw new Error('missing_flag_value')
    flags.set(flag, value)
    index += 1
  }
  const outputPath = flags.get('--output')
  if (outputPath === undefined) throw new Error('missing_output')
  return {
    outputPath,
    verify: booleans.has('--verify'),
    replace: booleans.has('--replace'),
    mode: booleans.has('--aggregate-only') ? 'aggregate_only' : 'pseudonymous',
  }
}

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  const result = publishAnalyticsSnapshot(
    { outputPath: args.outputPath, mode: args.mode, replace: args.replace },
    {
      getDrizzleDb,
      fence: createRekeyCutoverFence({ getDrizzleDb }),
      nowMs: () => Date.now(),
    },
  )
  if (args.verify) {
    const meta = verifySnapshotFile(result.path, {
      snapshotId: result.snapshotId,
      storageGeneration: result.storageGeneration,
    })
    console.log(
      `status=ok snapshot=${result.path} snapshot_id=${result.snapshotId} reconciliation=${meta.reconciliationStatus}`,
    )
    if (meta.reconciliationStatus !== 'reconciled') process.exit(1)
    return
  }
  console.log(
    `status=staged snapshot=${result.path} snapshot_id=${result.snapshotId} reconciliation=${result.reconciliationStatus}`,
  )
}

try {
  main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  closeDrizzleDb()
}
