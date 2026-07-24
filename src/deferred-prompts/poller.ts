// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ChatProvider } from '../chat/types.js'
import { emitGlobal, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import { scheduler } from '../scheduler-instance.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'
import { logSettledErrors, MAX_CONCURRENT_USERS, pollAlertsOnce } from './poller-alerts.js'
import { groupScheduledPromptsByDelivery } from './poller-groups.js'
import { stopRegisteredPollerTask } from './poller-lifecycle.js'
import { finalizeAllPrompts, mergeExecutionMetadata } from './poller-scheduled.js'
import { resolveProactivePlatformInstanceId, sendProactiveMessage } from './proactive-delivery.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getScheduledPromptsDue } from './scheduled.js'
import type { ScheduledPrompt } from './types.js'

export { pollAlertsOnce } from './poller-alerts.js'

const log = logger.child({ scope: 'deferred:poller' })
const ALERT_POLL_MS = 5 * 60_000,
  MAX_CONCURRENT_LLM_CALLS = 5,
  SCHEDULED_POLL_MS = 60_000
let isRunning = false
const inFlightPrompts = new Set<string>()
const promptToExecCtx = (prompt: ScheduledPrompt): DeferredExecutionContext => ({
  createdByUserId: prompt.createdByUserId,
  deliveryTarget: prompt.deliveryTarget,
})

async function executeScheduledPromptsForGroup(
  execCtx: DeferredExecutionContext,
  prompts: ScheduledPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const { createdByUserId } = execCtx
  // createdByUserId is the prompt owner id, which may be thread-scoped; strip it to the main
  // config-context key (where the timezone is stored) before the lookup.
  const timezone = getUserTimezoneOrDefault(getConfigContextIdFromStorageContextId(createdByUserId))
  const metadata = mergeExecutionMetadata(prompts)
  const mergedPrompt =
    prompts.length === 1 ? prompts[0]!.prompt : prompts.map((p, i) => `${String(i + 1)}. "${p.prompt}"`).join('\n')
  const promptIds = prompts.map((p) => p.id)

  log.debug({ userId: createdByUserId, promptCount: prompts.length, promptIds }, 'Executing scheduled prompts')
  if (resolveProactivePlatformInstanceId(chat, execCtx.deliveryTarget) === null) return
  let response: string
  try {
    response = await dispatchExecution(execCtx, 'scheduled', mergedPrompt, metadata, buildProviderFn)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { userId: createdByUserId, promptIds, error: errMsg },
      'Scheduled prompt execution failed before delivery',
    )
    const errText = `I ran into an error while working on that: ${errMsg}`
    const delivered = await sendProactiveMessage(chat, execCtx.deliveryTarget, errText)
    if (!delivered) return
    recordProactiveInHistory(getStorageContextId(execCtx.deliveryTarget), errText)
    finalizeAllPrompts(prompts, new Date().toISOString(), timezone)
    return
  }

  const delivered = await sendProactiveMessage(chat, execCtx.deliveryTarget, response)
  if (!delivered) return
  finalizeAllPrompts(prompts, new Date().toISOString(), timezone)
  for (const prompt of prompts) {
    emitUser('deferred:fired', prompt.createdByUserId, { promptId: prompt.id })
  }
}

export async function pollScheduledOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollScheduledOnce called')

  const duePrompts = getScheduledPromptsDue().filter((p) => !inFlightPrompts.has(p.id))
  emitGlobal('poller:scheduled', { dueCount: duePrompts.length })
  log.debug({ count: duePrompts.length }, 'Due scheduled prompts found')

  if (duePrompts.length === 0) return

  for (const prompt of duePrompts) {
    inFlightPrompts.add(prompt.id)
  }
  const byGroup = groupScheduledPromptsByDelivery(duePrompts)

  const limit = pLimit(MAX_CONCURRENT_LLM_CALLS)
  try {
    const results = await Promise.allSettled(
      [...byGroup.values()].map((prompts) => {
        const execCtx = promptToExecCtx(prompts[0]!)
        return limit((): Promise<void> => executeScheduledPromptsForGroup(execCtx, prompts, chat, buildProviderFn))
      }),
    )
    logSettledErrors(results, 'Error executing scheduled prompts for user')
  } finally {
    for (const prompt of duePrompts) {
      inFlightPrompts.delete(prompt.id)
    }
  }
}
export function startPollers(chat: ChatProvider, buildProviderFn: BuildProviderFn): void {
  if (isRunning) {
    log.warn('Pollers already running')
    return
  }
  isRunning = true
  scheduler.register('deferred-scheduled-poll', {
    interval: SCHEDULED_POLL_MS,
    handler: () => pollScheduledOnce(chat, buildProviderFn),
    options: { immediate: true },
  })

  scheduler.register('deferred-alert-poll', {
    interval: ALERT_POLL_MS,
    handler: () => pollAlertsOnce(chat, buildProviderFn),
    options: { immediate: true },
  })
  scheduler.start('deferred-scheduled-poll')
  scheduler.start('deferred-alert-poll')
  log.info({ scheduledPollMs: SCHEDULED_POLL_MS, alertPollMs: ALERT_POLL_MS }, 'Started deferred prompt pollers')
}
export function stopPollers(): void {
  log.info('Stopping deferred prompt pollers')
  stopRegisteredPollerTask(scheduler, 'deferred-scheduled-poll')
  stopRegisteredPollerTask(scheduler, 'deferred-alert-poll')
  isRunning = false
}
export type PollerSnapshot = {
  scheduledRunning: boolean
  alertsRunning: boolean
  scheduledIntervalMs: number
  alertIntervalMs: number
  maxConcurrentLlmCalls: number
  maxConcurrentUsers: number
}
export function getPollerSnapshot(): PollerSnapshot {
  return {
    scheduledRunning: isRunning,
    alertsRunning: isRunning,
    scheduledIntervalMs: SCHEDULED_POLL_MS,
    alertIntervalMs: ALERT_POLL_MS,
    maxConcurrentLlmCalls: MAX_CONCURRENT_LLM_CALLS,
    maxConcurrentUsers: MAX_CONCURRENT_USERS,
  }
}
