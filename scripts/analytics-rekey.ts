// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Planned rekey workflow CLI. Drives the frozen phase order via the
 * orchestrator actions. Usage:
 *   bun run scripts/analytics-rekey.ts plan --source-gen gen-1 --target-gen gen-2 \
 *     --from-versions v1 --to-versions v2
 *   bun run scripts/analytics-rekey.ts apply --run-id <id> --plan-hash <hash>
 *   bun run scripts/analytics-rekey.ts verify --run-id <id>
 *   bun run scripts/analytics-rekey.ts abort --run-id <id>
 * The generation-transition coordinator is the production
 * SnapshotConsumerCoordinator over a file-bound consumer when
 * ANALYTICS_SNAPSHOT_DIR is set; without it the coordinator stays fail-closed
 * and apply pauses at the cutover boundary. Remote egress remains a
 * fail-closed stub pending Task 15.
 */

import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'

import { getPolicy } from '../src/analytics/governance/policy-store.js'
import { createSnapshotConsumerCoordinator } from '../src/analytics/governance/snapshot-consumer.js'
import { createFileBoundConsumer } from '../src/analytics/governance/snapshot-file-consumer.js'
import type { GenerationTransitionCoordinator } from '../src/analytics/governance/snapshot-invalidator.js'
import { parseAnalyticsKeyring, parseGovernanceKeyring } from '../src/analytics/identity/keyring.js'
import { abortRekeyAction, applyRekeyAction, planRekeyAction, verifyRekeyAction } from '../src/analytics/jobs/rekey.js'
import type { RekeyWorkflowDeps } from '../src/analytics/jobs/rekey.js'
import { publishAnalyticsSnapshot } from '../src/analytics/jobs/snapshot.js'
import { createRekeyCutoverFence } from '../src/analytics/rekey/cutover-fence.js'
import type { RekeyFullKeyMaterial } from '../src/analytics/rekey/dual-write.js'
import type { RekeyRemoteEgress } from '../src/analytics/rekey/remote.js'
import { getRekeyRun } from '../src/analytics/rekey/run-store.js'
import { getDrizzleDb, closeDrizzleDb } from '../src/db/drizzle.js'

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

type CliArgs =
  | Readonly<{
      action: 'plan'
      sourceGeneration: string
      targetGeneration: string
      fromVersions: readonly string[]
      toVersions: readonly string[]
    }>
  | Readonly<{ action: 'apply'; runId: string; planHash: string }>
  | Readonly<{ action: 'verify'; runId: string }>
  | Readonly<{ action: 'abort'; runId: string }>

const takeValue = (argv: readonly string[], index: number): string => {
  const value = argv[index + 1]
  if (value === undefined) throw new Error('missing_flag_value')
  return value
}

const requireFlag = (flags: ReadonlyMap<string, string>, name: string, reason: string): string => {
  const value = flags.get(name)
  if (value === undefined) throw new Error(reason)
  return value
}

const requireVersions = (flags: ReadonlyMap<string, string>, name: string, reason: string): readonly string[] =>
  requireFlag(flags, name, reason)
    .split(',')
    .filter((entry) => entry.length > 0)

const parseArgs = (argv: readonly string[]): CliArgs => {
  const action = argv[0]
  if (action !== 'plan' && action !== 'apply' && action !== 'verify' && action !== 'abort')
    throw new Error('unknown_action')
  const flags = new Map<string, string>()
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index]
    if (flag === undefined || !flag.startsWith('--')) throw new Error('unknown_flag')
    flags.set(flag, takeValue(argv, index))
  }
  if (action === 'plan') {
    const sourceGeneration = requireFlag(flags, '--source-gen', 'missing_generation')
    const targetGeneration = requireFlag(flags, '--target-gen', 'missing_generation')
    const fromVersions = requireVersions(flags, '--from-versions', 'missing_from_versions')
    const toVersions = requireVersions(flags, '--to-versions', 'missing_to_versions')
    if (fromVersions.length === 0) throw new Error('missing_from_versions')
    if (toVersions.length === 0) throw new Error('missing_to_versions')
    return { action, sourceGeneration, targetGeneration, fromVersions, toVersions }
  }
  const runId = requireFlag(flags, '--run-id', 'missing_run_id')
  if (action === 'apply') {
    return { action, runId, planHash: requireFlag(flags, '--plan-hash', 'missing_plan_hash') }
  }
  return { action, runId }
}

const fullKeyMaterialFor = (toVersions: readonly string[]): RekeyFullKeyMaterial | null => {
  const toVersion = toVersions[0]
  if (toVersion === undefined) return null
  const analytics = parseAnalyticsKeyring()
  const governance = parseGovernanceKeyring()
  if (analytics.kind !== 'available' || governance.kind !== 'available') return null
  const analyticsToKey = analytics.keys.get(toVersion)
  const governanceToKey = governance.keys.get(toVersion)
  if (analyticsToKey === undefined || governanceToKey === undefined) return null
  return {
    toVersion,
    analyticsToKey,
    governanceToKey,
    encryptionKey: governance.activeKey,
    encryptionKeys: [...governance.keys.values()],
  }
}

const PENDING_TASK_15 = 'production remote egress lands in Task 15; run paused at the cutover boundary'

const MISSING_SNAPSHOT_DIR = 'ANALYTICS_SNAPSHOT_DIR is not configured; BI coordination stays fail-closed'

const failClosedCoordinator: GenerationTransitionCoordinator = {
  quiesceQueries: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
  closeSourceConnections: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
  buildTargetSnapshot: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
  remountAndVerify: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
  resumeQueries: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
  unlinkSourceFile: () => {
    throw new Error(MISSING_SNAPSHOT_DIR)
  },
}

const failClosedEgress: RekeyRemoteEgress = {
  pauseEgress: () => undefined,
  requestActorDeletion: () => {
    throw new Error(PENDING_TASK_15)
  },
  resumeEgress: () => undefined,
}

/** The production snapshot_republish coordinator over a file-bound BI consumer. */
const productionCoordinator = (snapshotDir: string): GenerationTransitionCoordinator => {
  if (!isAbsolute(snapshotDir)) throw new Error('ANALYTICS_SNAPSHOT_DIR must be an absolute path')
  const consumer = createFileBoundConsumer()
  return createSnapshotConsumerCoordinator({
    getDrizzleDb,
    consumer,
    pathForSnapshot: (snapshotId) => join(snapshotDir, `${snapshotId}.db`),
    buildSnapshot: ({ transitionRunId }) => {
      const snapshotId = `snap-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`
      const result = publishAnalyticsSnapshot(
        { outputPath: join(snapshotDir, `${snapshotId}.db`), transitionRunId, replace: true },
        {
          getDrizzleDb,
          fence: createRekeyCutoverFence({ getDrizzleDb }),
          nowMs: () => Date.now(),
          snapshotId: () => snapshotId,
        },
      )
      return {
        snapshotId: result.snapshotId,
        pathHash: result.pathHash,
        sourceHighWater: result.sourceHighWater,
      }
    },
    nowMs: () => Date.now(),
  }).transitionCoordinator
}

const resolveCoordinator = (): GenerationTransitionCoordinator => {
  const snapshotDir = process.env['ANALYTICS_SNAPSHOT_DIR']
  if (snapshotDir === undefined || snapshotDir === '') return failClosedCoordinator
  return productionCoordinator(snapshotDir)
}

const retainedHorizonDays = (): number => {
  const configured = getPolicy().retainedEventHorizonDays
  if (configured === null || configured === undefined) throw new Error('retained_event_horizon_not_configured')
  return configured
}

const workflowDeps = (toVersions: readonly string[]): RekeyWorkflowDeps => ({
  getDrizzleDb,
  keyMaterial: (): RekeyFullKeyMaterial | null => fullKeyMaterialFor(toVersions),
  coordinator: resolveCoordinator(),
  egress: failClosedEgress,
  fence: createRekeyCutoverFence({ getDrizzleDb }),
  retainedEventHorizonDays: retainedHorizonDays(),
  nowMs: (): number => Date.now(),
})

const runToVersions = (runId: string): readonly string[] => {
  const run = getRekeyRun(runId, { getDrizzleDb })
  if (run === null) throw new Error('run_not_found')
  const parsed: unknown = JSON.parse(run.toVersions)
  if (!Array.isArray(parsed)) throw new Error('run_to_versions_invalid')
  const versions: string[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'string') throw new Error('run_to_versions_invalid')
    versions.push(entry)
  }
  return versions
}

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  if (args.action === 'plan') {
    const result = planRekeyAction(args, workflowDeps(args.toVersions))
    console.log(`status=planned run_id=${result.runId} plan_hash=${result.planHash}`)
    return
  }
  if (args.action === 'abort') {
    const result = abortRekeyAction(args, workflowDeps([]))
    console.log(`status=${result} run_id=${args.runId}`)
    if (result !== 'aborted') process.exit(1)
    return
  }
  if (args.action === 'verify') {
    const report = verifyRekeyAction(args, workflowDeps(runToVersions(args.runId)))
    console.log(
      `status=verified run_id=${args.runId} equation_ok=${report.equation.ok} content_ok=${report.content.ok}`,
    )
    if (!report.equation.ok || !report.content.ok) process.exit(1)
    return
  }
  const result = applyRekeyAction(args, workflowDeps(runToVersions(args.runId)))
  console.log(
    `status=${result.status} run_id=${args.runId} phase=${result.phase} subphase=${result.subphase ?? 'none'}`,
  )
  if (result.status !== 'completed') process.exit(1)
}

try {
  main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  closeDrizzleDb()
}
