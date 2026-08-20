// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Central scheduler instance for the application.
 * All periodic tasks are registered here.
 */

import { isAbsolute } from 'node:path'

import { ANALYTICS_HMAC_KEYRING_ENV } from './analytics/config.js'
import { KeyVersionSchema } from './analytics/controlled-types.js'
import type { EffectiveLanes } from './analytics/governance/policy-store.js'
import { getPolicy, resolveEffectiveLanes } from './analytics/governance/policy-store.js'
import { parseAnalyticsKeyring } from './analytics/identity/keyring.js'
import type { AnalyticsJobDeps, AnalyticsJobKeyMaterial } from './analytics/jobs/register.js'
import {
  ANALYTICS_SNAPSHOT_PATH_ENV,
  registerAnalyticsJobs,
  unregisterAnalyticsJobs,
} from './analytics/jobs/register.js'
import { createRekeyCutoverFence } from './analytics/rekey/cutover-fence.js'
import type { AnalyticsObserver } from './analytics/runtime.js'
import { getActiveAnalyticsRuntime } from './analytics/start-analytics.js'
import { getOpenEpoch } from './analytics/storage/epoch-store.js'
import { purgeExpiredStagedFiles } from './attachments/index.js'
import { cleanupExpiredCaches } from './cache.js'
import { getDrizzleDb } from './db/drizzle.js'
import { logger } from './logger.js'
import { sweepDirtyContexts } from './long-term-memory/capture-sweep.js'
import { runMemoryMaintenance } from './long-term-memory/maintenance.js'
import { sweepPromotions } from './long-term-memory/promotion-sweep.js'
import { runMessageEmbeddingSweep } from './message-embedding-sweep.js'
import { cleanupExpiredQueues } from './message-queue/index.js'
import { type FatalErrorEvent, type ErrorEvent, createScheduler } from './utils/scheduler.js'
const log = logger.child({ scope: 'scheduler-instance' })

// Create singleton scheduler
export const scheduler = createScheduler({
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
})

export const DEFAULT_SCHEDULER_TASK_NAMES = [
  'user-cache-cleanup',
  'message-queue-cleanup',
  'staged-files-purge',
  'long-term-memory-maintenance',
  'memory-capture-sweep',
  'memory-promotion-sweep',
  'message-embedding-sweep',
] as const

function registerImmediateDefaultTasks(): void {
  scheduler.register('user-cache-cleanup', {
    interval: 5 * 60 * 1000,
    handler: cleanupExpiredCaches,
    options: { immediate: true },
  })
  scheduler.register('message-queue-cleanup', {
    interval: 5 * 60 * 1000,
    handler: cleanupExpiredQueues,
    options: { immediate: true },
  })
  scheduler.register('staged-files-purge', {
    interval: 60 * 60 * 1000,
    handler: () => {
      purgeExpiredStagedFiles()
    },
    options: { immediate: true },
  })
  scheduler.register('long-term-memory-maintenance', {
    interval: 60 * 60 * 1000,
    handler: () => {
      runMemoryMaintenance()
    },
    options: { immediate: true },
  })
}

function registerDeferredDefaultTasks(): void {
  scheduler.register('memory-capture-sweep', {
    interval: 5 * 60 * 1000,
    handler: () => {
      void sweepDirtyContexts(new Date().toISOString())
    },
    options: { immediate: false },
  })
  scheduler.register('memory-promotion-sweep', {
    interval: 30 * 60 * 1000,
    handler: () => {
      void sweepPromotions()
    },
    options: { immediate: false },
  })
  scheduler.register('message-embedding-sweep', {
    interval: 5 * 60 * 1000,
    handler: () => {
      void runMessageEmbeddingSweep()
    },
    options: { immediate: false },
  })
}

export function registerDefaultSchedulerTasks(): void {
  if (scheduler.hasTask('user-cache-cleanup')) return
  registerImmediateDefaultTasks()
  registerDeferredDefaultTasks()
}

export function unregisterDefaultSchedulerTasks(): void {
  for (const taskName of DEFAULT_SCHEDULER_TASK_NAMES) {
    if (scheduler.hasTask(taskName)) scheduler.unregister(taskName)
  }
}

const OFF_LANES: EffectiveLanes = {
  killSwitchActive: true,
  localMode: 'off',
  externalAggregateEnabled: false,
  externalPseudonymousEnabled: false,
}

const readAnalyticsLanes = (): EffectiveLanes => {
  try {
    return resolveEffectiveLanes({ policy: getPolicy() })
  } catch {
    return OFF_LANES
  }
}

const readAnalyticsKeyMaterial = (): AnalyticsJobKeyMaterial | null => {
  const keyring = parseAnalyticsKeyring(process.env[ANALYTICS_HMAC_KEYRING_ENV])
  if (keyring.kind !== 'available') return null
  return { key: keyring.activeKey, keyVersion: KeyVersionSchema.parse(keyring.activeVersion) }
}

const readSnapshotPath = (): string | null => {
  const configured = process.env[ANALYTICS_SNAPSHOT_PATH_ENV]
  return typeof configured === 'string' && configured.length > 0 && isAbsolute(configured) ? configured : null
}

const readOpenEpochId = (): string | null => {
  try {
    return getOpenEpoch({ getDrizzleDb })?.epochId ?? null
  } catch {
    return null
  }
}

export const buildAnalyticsJobDeps = (): AnalyticsJobDeps => ({
  nowMs: Date.now,
  getDrizzleDb,
  lanes: readAnalyticsLanes,
  observer: (): AnalyticsObserver | null => getActiveAnalyticsRuntime()?.observer ?? null,
  openEpochId: readOpenEpochId,
  keyMaterial: readAnalyticsKeyMaterial,
  snapshotPath: readSnapshotPath,
  fence: createRekeyCutoverFence({ getDrizzleDb }),
})

export function registerAnalyticsSchedulerJobs(): void {
  registerAnalyticsJobs(scheduler, buildAnalyticsJobDeps())
}

export function unregisterAnalyticsSchedulerJobs(): void {
  unregisterAnalyticsJobs(scheduler)
}

// Event hooks
scheduler.on('error', ({ name, error, attempt }: ErrorEvent) => {
  // Errors are logged by scheduler, add any additional alerting here
  log.error({ taskName: name, attempt, error: error instanceof Error ? error.message : String(error) }, 'Task failed')
})

scheduler.on('fatalError', ({ name, error }: FatalErrorEvent) => {
  // Task failed permanently - could alert on-call here
  log.error(
    { taskName: name, error: error instanceof Error ? error.message : String(error) },
    'Task failed permanently',
  )
})
