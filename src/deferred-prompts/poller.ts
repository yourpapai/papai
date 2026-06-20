// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { ChatProvider } from '../chat/types.js'
import { emitGlobal, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'
import { scheduler } from '../scheduler-instance.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'
import { describeCondition, evaluateCondition, getEligibleAlertPrompts, updateAlertTriggerTime } from './alerts.js'
import { alertsNeedFullTasks, enrichTasks, fetchAllTasks } from './fetch-tasks.js'
import { groupScheduledPromptsByDelivery } from './poller-groups.js'
import { stopRegisteredPollerTask } from './poller-lifecycle.js'
import { finalizeAllPrompts, mergeExecutionMetadata } from './poller-scheduled.js'
import { resolveProactivePlatformInstanceId, sendProactiveMessage } from './proactive-delivery.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getScheduledPromptsDue } from './scheduled.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { AlertPrompt, ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller' })
const ALERT_POLL_MS = 5 * 60_000,
  MAX_CONCURRENT_LLM_CALLS = 5,
  MAX_CONCURRENT_USERS = 10,
  SCHEDULED_POLL_MS = 60_000
let isRunning = false
type AlertDeliveryResult = { matched: boolean; delivered: boolean }
const inFlightPrompts = new Set<string>()
const formatTaskStatus = (status: string | undefined): string => (status === undefined ? '' : ` (${status})`)
function logSettledErrors(results: PromiseSettledResult<unknown>[], context: string): void {
  for (const r of results) {
    if (r.status === 'rejected') log.error({ error: String(r.reason) }, context)
  }
}
const promptToExecCtx = (prompt: ScheduledPrompt): DeferredExecutionContext => ({
  createdByUserId: prompt.createdByUserId,
  deliveryTarget: prompt.deliveryTarget,
})
const alertToExecCtx = (alert: AlertPrompt): DeferredExecutionContext => ({
  createdByUserId: alert.createdByUserId,
  deliveryTarget: alert.deliveryTarget,
})
const alertDeliveryContextKey = (alert: AlertPrompt): string => getStorageContextId(alert.deliveryTarget)
const configContextIdForDelivery = (deliveryTarget: DeferredExecutionContext['deliveryTarget']): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(deliveryTarget))

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

  log.debug(
    { userId: createdByUserId, promptCount: prompts.length, promptIds, mode: metadata.mode },
    'Executing scheduled prompts',
  )
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
    const delivered = await sendProactiveMessage(
      chat,
      execCtx.deliveryTarget,
      `I ran into an error while working on that: ${errMsg}`,
    )
    if (!delivered) return
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

function markAlertDelivered(alert: AlertPrompt, matchedCount: number, emitNotifications: boolean): AlertDeliveryResult {
  const now = new Date().toISOString()
  updateAlertTriggerTime(alert.id, alert.createdByUserId, now)
  log.info({ id: alert.id, userId: alert.createdByUserId, matchedCount }, 'Alert triggered')
  if (emitNotifications) {
    emitUser('deferred:alerted', alert.createdByUserId, { promptId: alert.id })
    emitUser('notify:deferred_alert', alert.createdByUserId, { promptId: alert.id })
  }
  return { matched: true, delivered: true }
}

async function executeSingleAlert(
  alert: AlertPrompt,
  tasks: Task[],
  snapshots: Map<string, string>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<AlertDeliveryResult> {
  const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
  if (matchedTasks.length === 0) return { matched: false, delivered: false }

  const conditionDesc = describeCondition(alert.condition)
  const taskList = matchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
  const matchedTasksSummary = `Alert condition: ${conditionDesc}\n${taskList}`

  const execCtx = alertToExecCtx(alert)
  if (resolveProactivePlatformInstanceId(chat, alert.deliveryTarget) === null)
    return { matched: true, delivered: false }
  let response: string
  try {
    response = await dispatchExecution(
      execCtx,
      'alert',
      alert.prompt,
      alert.executionMetadata,
      buildProviderFn,
      matchedTasksSummary,
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { id: alert.id, userId: alert.createdByUserId, error: errMsg },
      'Alert prompt execution failed before delivery',
    )
    const delivered = await sendProactiveMessage(
      chat,
      alert.deliveryTarget,
      `Sorry, something went wrong while preparing this update: ${errMsg}`,
    )
    if (!delivered) return { matched: true, delivered: false }
    return markAlertDelivered(alert, matchedTasks.length, false)
  }

  const delivered = await sendProactiveMessage(chat, alert.deliveryTarget, response)
  if (!delivered) return { matched: true, delivered: false }
  return markAlertDelivered(alert, matchedTasks.length, true)
}

const shouldAdvanceAlertSnapshots = (results: PromiseSettledResult<AlertDeliveryResult>[]): boolean =>
  results.every((result) => {
    if (result.status === 'rejected') return false
    if (!result.value.matched) return true
    return result.value.delivered
  })

async function executeAlertsForUser(
  userId: string,
  alerts: AlertPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
  const configContextId = configContextIdForDelivery(alerts[0]!.deliveryTarget)
  if (resolveProactivePlatformInstanceId(chat, alerts[0]!.deliveryTarget) === null) return
  const provider = await buildProviderFn(configContextId)
  if (provider === null) {
    log.warn({ userId, storageContextId, configContextId }, 'Could not build task provider for alert polling')
    return
  }

  let tasks = await fetchAllTasks(provider)
  const snapshots = getSnapshotsForUser(storageContextId)

  if (tasks.length > 0 && alertsNeedFullTasks(alerts)) {
    log.debug({ userId, taskCount: tasks.length }, 'Enriching tasks with full details for alert conditions')
    tasks = await enrichTasks(provider, tasks)
  }

  const alertLimit = pLimit(MAX_CONCURRENT_LLM_CALLS)
  const alertResults = await Promise.allSettled(
    alerts.map((alert) =>
      alertLimit(
        (): Promise<AlertDeliveryResult> => executeSingleAlert(alert, tasks, snapshots, chat, buildProviderFn, evalNow),
      ),
    ),
  )
  logSettledErrors(alertResults, 'Error evaluating alert')

  if (!shouldAdvanceAlertSnapshots(alertResults)) return
  updateSnapshots(storageContextId, tasks)
}
export async function pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollAlertsOnce called')
  const eligibleAlerts = getEligibleAlertPrompts()
  emitGlobal('poller:alerts', { eligibleCount: eligibleAlerts.length })
  if (eligibleAlerts.length === 0) return
  const now = new Date()
  const byDeliveryContext = new Map<string, AlertPrompt[]>()
  for (const alert of eligibleAlerts) {
    const key = alertDeliveryContextKey(alert)
    const existing = byDeliveryContext.get(key)
    if (existing === undefined) byDeliveryContext.set(key, [alert])
    else existing.push(alert)
  }
  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byDeliveryContext.values()].map((alerts) =>
      userLimit(
        (): Promise<void> => executeAlertsForUser(alerts[0]!.createdByUserId, alerts, chat, buildProviderFn, now),
      ),
    ),
  )
  logSettledErrors(results, 'Error polling alerts for user')
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
