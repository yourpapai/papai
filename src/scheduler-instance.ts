/**
 * Central scheduler instance for the application.
 * All periodic tasks are registered here.
 */

import { purgeExpiredStagedFiles } from './attachments/staged.js'
import { cleanupExpiredCaches } from './cache.js'
import { sweepExpiredMessages } from './message-cache/cache.js'
import { cleanupExpiredMessages } from './message-cache/persistence.js'
import { cleanupExpiredQueues } from './message-queue/index.js'
import { createScheduler } from './utils/scheduler.js'
import type { ErrorEvent, FatalErrorEvent } from './utils/scheduler.types.js'
import { cleanupExpiredWizardSessions } from './wizard/state.js'

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

scheduler.register('wizard-session-cleanup', {
  // Every 10 minutes
  interval: 10 * 60 * 1000,
  handler: cleanupExpiredWizardSessions,
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

// Event hooks
scheduler.on('error', ({ name, error, attempt }: ErrorEvent) => {
  // Errors are logged by scheduler, add any additional alerting here
  console.error(`Task ${name} failed (attempt ${attempt}):`, error)
})

scheduler.on('fatalError', ({ name, error }: FatalErrorEvent) => {
  // Task failed permanently - could alert on-call here
  console.error(`Task ${name} failed permanently:`, error)
})
