// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatProvider } from '../chat/types.js'
import { logger } from '../logger.js'
import type { Scheduler } from '../utils/scheduler.js'
import { MAX_CONCURRENT_LLM_CALLS, MAX_CONCURRENT_USERS, pollAlertsOnce } from './poller-alerts.js'
import { pollScheduledOnce } from './poller.js'
import type { BuildProviderFn } from './proactive-llm.js'

const SCHEDULED_POLL_TASK = 'deferred-scheduled-poll'
const ALERT_POLL_TASK = 'deferred-alert-poll'
const ALERT_POLL_MS = 5 * 60_000
const SCHEDULED_POLL_MS = 60_000

export type PollerSnapshot = {
  scheduledRunning: boolean
  alertsRunning: boolean
  scheduledIntervalMs: number
  alertIntervalMs: number
  maxConcurrentLlmCalls: number
  maxConcurrentUsers: number
}

export interface PollerLifecycle {
  startPollers: (chat: ChatProvider, buildProviderFn: BuildProviderFn) => void
  stopPollers: () => void
  getPollerSnapshot: () => PollerSnapshot
}

export function stopRegisteredPollerTask(scheduler: Scheduler, taskName: string): void {
  if (!scheduler.hasTask(taskName)) return
  scheduler.stop(taskName)
  scheduler.unregister(taskName)
}

export function createPollerLifecycle(scheduler: Scheduler): PollerLifecycle {
  const log = logger.child({ scope: 'deferred:poller' })
  let isRunning = false

  const startPollers = (chat: ChatProvider, buildProviderFn: BuildProviderFn): void => {
    if (isRunning) {
      log.warn('Pollers already running')
      return
    }
    isRunning = true
    scheduler.register(SCHEDULED_POLL_TASK, {
      interval: SCHEDULED_POLL_MS,
      handler: () => pollScheduledOnce(chat, buildProviderFn),
      options: { immediate: true },
    })
    scheduler.register(ALERT_POLL_TASK, {
      interval: ALERT_POLL_MS,
      handler: () => pollAlertsOnce(chat, buildProviderFn),
      options: { immediate: true },
    })
    scheduler.start(SCHEDULED_POLL_TASK)
    scheduler.start(ALERT_POLL_TASK)
    log.info({ scheduledPollMs: SCHEDULED_POLL_MS, alertPollMs: ALERT_POLL_MS }, 'Started deferred prompt pollers')
  }

  const stopPollers = (): void => {
    log.info('Stopping deferred prompt pollers')
    stopRegisteredPollerTask(scheduler, SCHEDULED_POLL_TASK)
    stopRegisteredPollerTask(scheduler, ALERT_POLL_TASK)
    isRunning = false
  }

  const getPollerSnapshot = (): PollerSnapshot => ({
    scheduledRunning: isRunning,
    alertsRunning: isRunning,
    scheduledIntervalMs: SCHEDULED_POLL_MS,
    alertIntervalMs: ALERT_POLL_MS,
    maxConcurrentLlmCalls: MAX_CONCURRENT_LLM_CALLS,
    maxConcurrentUsers: MAX_CONCURRENT_USERS,
  })

  return { startPollers, stopPollers, getPollerSnapshot }
}
