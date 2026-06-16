// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Central scheduler instance for the application.
 * All periodic tasks are registered here.
 */

import { purgeExpiredStagedFiles } from './attachments/staged.js'
import { cleanupExpiredCaches } from './cache.js'
import { logger } from './logger.js'
import { sweepDirtyContexts } from './long-term-memory/capture-sweep.js'
import { runMemoryMaintenance } from './long-term-memory/maintenance.js'
import { sweepPromotions } from './long-term-memory/promotion-sweep.js'
import { sweepExpiredMessages } from './message-cache/cache.js'
import { cleanupExpiredMessages } from './message-cache/persistence.js'
import { cleanupExpiredQueues } from './message-queue/index.js'
import { createScheduler } from './utils/scheduler.js'
import type { ErrorEvent, FatalErrorEvent } from './utils/scheduler.types.js'
const log = logger.child({ scope: 'scheduler-instance' })

// Create singleton scheduler
export const scheduler = createScheduler({
  unrefByDefault: true,
  defaultRetries: 3,
  maxRetryDelay: 60_000,
})

// Register cleanup tasks
scheduler.register('user-cache-cleanup', {
  // 5 minutes
  interval: 5 * 60 * 1000,
  handler: cleanupExpiredCaches,
  options: { immediate: true },
})

scheduler.register('message-cache-sweep', {
  // Daily
  interval: 24 * 60 * 60 * 1000,
  handler: sweepExpiredMessages,
  options: { immediate: true },
})

scheduler.register('message-cleanup', {
  // Hourly
  interval: 60 * 60 * 1000,
  handler: cleanupExpiredMessages,
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
