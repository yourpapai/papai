// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getDrizzleDb as defaultGetDrizzleDb } from '../../db/drizzle.js'
import { analyticsBackfillRuns } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { TaskHandler } from '../../utils/scheduler.js'
import { utcDayOfMs } from '../aggregate.js'
import { runDeliveryWorkerTick } from '../delivery/worker.js'
import type { EffectiveLanes } from '../governance/policy-store.js'
import { createRekeyCutoverFence } from '../rekey/cutover-fence.js'
import type { RekeyCutoverFence } from '../rekey/cutover-fence.js'
import { utcDayStartMs } from '../retention/expiry-guard.js'
import { finalizeUtcDayBuckets } from '../storage/epoch-store.js'
import { highWaterBoundMs } from './backfill-readers.js'
import { runBackfillJob } from './backfill.js'
import { runCensorMaturitySweep } from './censor-maturity.js'
import { runDeriveJob } from './derive.js'
import { runIntentDerivation } from './intent.js'
import { runReconciliation } from './reconcile.js'
import { DERIVE_WINDOW_MS, FINALIZE_GRACE_MS, HIGHWATER_BATCH_SIZE, INTENT_PAGE_LIMIT } from './register.js'
import type {
  AnalyticsJobDeps,
  AnalyticsJobKeyMaterial,
  AnalyticsJobName,
  AnalyticsJobRunnerOverrides,
} from './register.js'
import { runExpirySweep } from './retention.js'
import { publishAnalyticsSnapshot } from './snapshot.js'

const log = logger.child({ scope: 'analytics:jobs:handlers' })

const DAY_MS = 86_400_000

type StoreDeps = Readonly<{ getDrizzleDb: typeof defaultGetDrizzleDb; fence?: RekeyCutoverFence }>

const storeDeps = (deps: AnalyticsJobDeps): StoreDeps => ({ getDrizzleDb: deps.getDrizzleDb, fence: deps.fence })

const finalizePriorUtcDay = (deps: AnalyticsJobDeps, nowMs: number): void => {
  const todayStartMs = utcDayStartMs(utcDayOfMs(nowMs))
  if (nowMs < todayStartMs + FINALIZE_GRACE_MS) return
  finalizeUtcDayBuckets({ utcDay: utcDayOfMs(nowMs - DAY_MS) }, { getDrizzleDb: deps.getDrizzleDb })
}

const pseudonymousInput = (
  deps: AnalyticsJobDeps,
  lanes: EffectiveLanes,
): { epochId: string; key: AnalyticsJobKeyMaterial; localMode: 'local_pseudonymous' } | null => {
  if (lanes.localMode !== 'local_pseudonymous') return null
  const key = deps.keyMaterial()
  const epochId = deps.openEpochId()
  if (key === null || epochId === null) return null
  return { epochId, key, localMode: 'local_pseudonymous' }
}

const snapshotFence = (deps: AnalyticsJobDeps): RekeyCutoverFence =>
  deps.fence ?? createRekeyCutoverFence({ getDrizzleDb: deps.getDrizzleDb })

/**
 * Durable checkpoint for the scheduled high-water normalization: the earliest
 * completed run bound, or 0 when no run has completed yet. Scanning from the
 * minimum completed bound keeps the tick incremental without skipping rows
 * that straddle a per-table boundary (idempotent apply absorbs re-reads).
 */
const readHighWaterCheckpointMs = (deps: AnalyticsJobDeps, runIdPrefix: string = 'backfill-v1'): number => {
  const rows = deps
    .getDrizzleDb()
    .select({
      runId: analyticsBackfillRuns.runId,
      status: analyticsBackfillRuns.status,
      highWaterRowKey: analyticsBackfillRuns.highWaterRowKey,
    })
    .from(analyticsBackfillRuns)
    .all()
  const bounds = rows
    .filter(
      (row) => row.status === 'completed' && row.runId.startsWith(`${runIdPrefix}:`) && row.highWaterRowKey.length > 0,
    )
    .map((row) => highWaterBoundMs(row.highWaterRowKey))
  return bounds.length === 0 ? 0 : Math.min(...bounds)
}

const flushHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return async () => {
    if (deps.lanes().localMode === 'off') return
    const nowMs = deps.nowMs()
    if (run.flush !== undefined) {
      await run.flush(nowMs)
      return
    }
    await deps.observer()?.flush()
    finalizePriorUtcDay(deps, nowMs)
  }
}

const highwaterHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    if (deps.lanes().localMode === 'off') return
    const nowMs = deps.nowMs()
    if (run.highwater !== undefined) {
      run.highwater(nowMs)
      return
    }
    const key = deps.keyMaterial()
    if (key === null) return
    runBackfillJob(
      {
        source: 'all',
        batchSize: HIGHWATER_BATCH_SIZE,
        dryRun: false,
        resume: true,
        cutoffMs: readHighWaterCheckpointMs(deps),
        key: key.key,
        keyVersion: key.keyVersion,
        nowMs,
      },
      storeDeps(deps),
    )
  }
}

const intentHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    const lanes = deps.lanes()
    if (lanes.localMode !== 'local_pseudonymous') return
    const nowMs = deps.nowMs()
    if (run.intent !== undefined) {
      run.intent(nowMs)
      return
    }
    const input = pseudonymousInput(deps, lanes)
    if (input === null) return
    runIntentDerivation(
      {
        processEpochId: input.epochId,
        key: input.key.key,
        keyVersion: input.key.keyVersion,
        nowMs,
        localMode: input.localMode,
        limit: INTENT_PAGE_LIMIT,
      },
      storeDeps(deps),
    )
  }
}

const deriveHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    const lanes = deps.lanes()
    if (lanes.localMode !== 'local_pseudonymous') return
    const nowMs = deps.nowMs()
    if (run.derive !== undefined) {
      run.derive(nowMs)
      return
    }
    const input = pseudonymousInput(deps, lanes)
    if (input === null) return
    runDeriveJob(
      {
        processEpochId: input.epochId,
        key: input.key.key,
        keyVersion: input.key.keyVersion,
        nowMs,
        localMode: input.localMode,
        windowStartMs: nowMs - DERIVE_WINDOW_MS,
        windowEndMs: nowMs,
      },
      storeDeps(deps),
    )
  }
}

const deliveryHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return async () => {
    const lanes = deps.lanes()
    if (!lanes.externalAggregateEnabled && !lanes.externalPseudonymousEnabled) return
    const nowMs = deps.nowMs()
    if (run.delivery !== undefined) {
      await run.delivery(nowMs)
      return
    }
    await runDeliveryWorkerTick({ nowMs }, storeDeps(deps))
  }
}

const reconcileHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    if (deps.lanes().localMode === 'off') return
    const nowMs = deps.nowMs()
    if (run.reconcile !== undefined) {
      run.reconcile(nowMs)
      return
    }
    runReconciliation({ nowMs, apply: true }, storeDeps(deps))
  }
}

const snapshotHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    if (deps.lanes().killSwitchActive) return
    const outputPath = deps.snapshotPath()
    if (outputPath === null) return
    const nowMs = deps.nowMs()
    if (run.snapshot !== undefined) {
      run.snapshot(nowMs)
      return
    }
    publishAnalyticsSnapshot(
      { outputPath, replace: true },
      { getDrizzleDb: deps.getDrizzleDb, fence: snapshotFence(deps), nowMs: deps.nowMs },
    )
  }
}

const expiryPurgeHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    const nowMs = deps.nowMs()
    if (run.expiryPurge !== undefined) {
      run.expiryPurge(nowMs)
      return
    }
    const result = runExpirySweep({ nowMs }, storeDeps(deps))
    log.debug({ status: result.status, nextWakeMs: result.nextWakeMs }, 'expiry sweep finished')
  }
}

const censorMaturityHandler = (deps: AnalyticsJobDeps, run: AnalyticsJobRunnerOverrides): TaskHandler => {
  return () => {
    if (deps.lanes().localMode !== 'local_pseudonymous') return
    const nowMs = deps.nowMs()
    if (run.censorMaturity !== undefined) {
      run.censorMaturity(nowMs)
      return
    }
    const written = runCensorMaturitySweep(storeDeps(deps))
    if (written > 0) log.info({ written }, 'censor maturity sweep applied intervals')
  }
}

/**
 * Builds the nine gated job handlers. Every handler re-checks the kill
 * switch/mode at entry (a mode change while a job is queued exits before any
 * actor data is read or sent); expiry purge is intentionally ungated because
 * deletion must never be blocked by collection mode.
 */
export const createAnalyticsJobHandlers = (deps: AnalyticsJobDeps): Record<AnalyticsJobName, TaskHandler> => {
  const run = deps.overrides ?? {}
  return {
    'analytics-aggregate-flush': flushHandler(deps, run),
    'analytics-usage-highwater': highwaterHandler(deps, run),
    'analytics-intent-scan': intentHandler(deps, run),
    'analytics-derive': deriveHandler(deps, run),
    'analytics-delivery': deliveryHandler(deps, run),
    'analytics-reconcile': reconcileHandler(deps, run),
    'analytics-snapshot': snapshotHandler(deps, run),
    'analytics-expiry-purge': expiryPurgeHandler(deps, run),
    'analytics-censor-maturity': censorMaturityHandler(deps, run),
  }
}
