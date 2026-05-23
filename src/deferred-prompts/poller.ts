// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import type { ChatProvider } from '../chat/types.js'
import { emitGlobal, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { Task } from '../providers/types.js'
import { scheduler } from '../scheduler-instance.js'
import { getUserTimezoneOrDefault } from '../utils/config-timezone.js'
import { describeCondition, evaluateCondition, getEligibleAlertPrompts, updateAlertTriggerTime } from './alerts.js'
import { alertsNeedFullTasks, enrichTasks, fetchAllTasks } from './fetch-tasks.js'
import { groupScheduledPromptsByDelivery } from './poller-groups.js'
import { finalizeAllPrompts, mergeExecutionMetadata } from './poller-scheduled.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import { getScheduledPromptsDue } from './scheduled.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { AlertPrompt, ScheduledPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller' })
const SCHEDULED_POLL_MS = 60_000
const ALERT_POLL_MS = 5 * 60_000
const MAX_CONCURRENT_LLM_CALLS = 5
const MAX_CONCURRENT_USERS = 10
let isRunning = false

// In-flight prompt tracking to prevent multiple executions if poller interval is short or task is slow
const inFlightPrompts = new Set<string>()
function formatTaskStatus(status: string | undefined): string {
  return status === undefined ? '' : ` (${status})`
}
function logSettledErrors(results: PromiseSettledResult<void>[], context: string): void {
  for (const r of results) {
    if (r.status === 'rejected') log.error({ error: String(r.reason) }, context)
  }
}

function promptToExecCtx(prompt: ScheduledPrompt): DeferredExecutionContext {
  return { createdByUserId: prompt.createdByUserId, deliveryTarget: prompt.deliveryTarget }
}

function alertToExecCtx(alert: AlertPrompt): DeferredExecutionContext {
  return { createdByUserId: alert.createdByUserId, deliveryTarget: alert.deliveryTarget }
}

const alertDeliveryContextKey = (alert: AlertPrompt): string => getStorageContextId(alert.deliveryTarget)

async function executeScheduledPromptsForGroup(
  execCtx: DeferredExecutionContext,
  prompts: ScheduledPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<void> {
  const { createdByUserId } = execCtx
  const timezone = getUserTimezoneOrDefault(createdByUserId)
  const metadata = mergeExecutionMetadata(prompts)
  const mergedPrompt =
    prompts.length === 1 ? prompts[0]!.prompt : prompts.map((p, i) => `${String(i + 1)}. "${p.prompt}"`).join('\n')
  const promptIds = prompts.map((p) => p.id)

  log.debug(
    { userId: createdByUserId, promptCount: prompts.length, promptIds, mode: metadata.mode },
    'Executing scheduled prompts',
  )
  let response: string
  try {
    response = await dispatchExecution(execCtx, 'scheduled', mergedPrompt, metadata, buildProviderFn)
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { userId: createdByUserId, promptIds, error: errMsg },
      'Scheduled prompt execution failed before delivery',
    )
    await chat.sendMessage(execCtx.deliveryTarget, `I ran into an error while working on that: ${errMsg}`)
    finalizeAllPrompts(prompts, new Date().toISOString(), timezone)
    return
  }

  await chat.sendMessage(execCtx.deliveryTarget, response)
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

async function executeSingleAlert(
  alert: AlertPrompt,
  tasks: Task[],
  snapshots: Map<string, string>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
  if (matchedTasks.length === 0) return

  const conditionDesc = describeCondition(alert.condition)
  const taskList = matchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
  const matchedTasksSummary = `Alert condition: ${conditionDesc}\n${taskList}`

  const execCtx = alertToExecCtx(alert)
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
    await chat.sendMessage(alert.deliveryTarget, `Sorry, something went wrong while preparing this update: ${errMsg}`)
    const now = new Date().toISOString()
    updateAlertTriggerTime(alert.id, alert.createdByUserId, now)
    log.info({ id: alert.id, userId: alert.createdByUserId, matchedCount: matchedTasks.length }, 'Alert triggered')
    return
  }

  await chat.sendMessage(alert.deliveryTarget, response)
  const now = new Date().toISOString()
  updateAlertTriggerTime(alert.id, alert.createdByUserId, now)
  log.info({ id: alert.id, userId: alert.createdByUserId, matchedCount: matchedTasks.length }, 'Alert triggered')
  emitUser('deferred:alerted', alert.createdByUserId, { promptId: alert.id })
  emitUser('notify:deferred_alert', alert.createdByUserId, { promptId: alert.id })
}

async function executeAlertsForUser(
  userId: string,
  alerts: AlertPrompt[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
  const provider = buildProviderFn(storageContextId)
  if (provider === null) {
    log.warn({ userId, storageContextId }, 'Could not build task provider for alert polling')
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
      alertLimit((): Promise<void> => executeSingleAlert(alert, tasks, snapshots, chat, buildProviderFn, evalNow)),
    ),
  )
  logSettledErrors(alertResults, 'Error evaluating alert')

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
    if (existing === undefined) {
      byDeliveryContext.set(key, [alert])
    } else {
      existing.push(alert)
    }
  }

  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byDeliveryContext.values()].map((alerts) =>
      userLimit((): Promise<void> => executeAlertsForUser(alerts[0]!.createdByUserId, alerts, chat, buildProviderFn, now)),
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

  // Register scheduled poll task
  scheduler.register('deferred-scheduled-poll', {
    interval: SCHEDULED_POLL_MS,
    handler: () => pollScheduledOnce(chat, buildProviderFn),
    options: { immediate: true },
  })

  // Register alert poll task
  scheduler.register('deferred-alert-poll', {
    interval: ALERT_POLL_MS,
    handler: () => pollAlertsOnce(chat, buildProviderFn),
    options: { immediate: true },
  })

  // Start both tasks
  scheduler.start('deferred-scheduled-poll')
  scheduler.start('deferred-alert-poll')

  log.info({ scheduledPollMs: SCHEDULED_POLL_MS, alertPollMs: ALERT_POLL_MS }, 'Started deferred prompt pollers')
}

export function stopPollers(): void {
  log.info('Stopping deferred prompt pollers')

  scheduler.stop('deferred-scheduled-poll')
  scheduler.stop('deferred-alert-poll')
  scheduler.unregister('deferred-scheduled-poll')
  scheduler.unregister('deferred-alert-poll')

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
