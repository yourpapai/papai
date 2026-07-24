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
import type { Task } from '../providers/types.js'
import {
  describeCondition,
  evaluateCondition,
  getEligibleAlertPrompts,
  updateAlertMatchedTaskIds,
  updateAlertMatchState,
} from './alerts.js'
import { alertsNeedFullTasks, enrichTasks, fetchAllTasks } from './fetch-tasks.js'
import { mergeExecutionMetadata } from './poller-scheduled.js'
import { resolveProactivePlatformInstanceId, sendProactiveMessage } from './proactive-delivery.js'
import { getStorageContextId } from './proactive-llm-helpers.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { AlertPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:alerts' })

export const MAX_CONCURRENT_USERS = 10

export function logSettledErrors(results: PromiseSettledResult<unknown>[], context: string): void {
  for (const r of results) {
    if (r.status === 'rejected') log.error({ error: String(r.reason) }, context)
  }
}

type AlertEvaluation = {
  alert: AlertPrompt
  matchedNow: string[]
  newMatchedTasks: Task[]
}

const alertToExecCtx = (alert: AlertPrompt): DeferredExecutionContext => ({
  createdByUserId: alert.createdByUserId,
  deliveryTarget: alert.deliveryTarget,
})

const alertDeliveryContextKey = (alert: AlertPrompt): string => getStorageContextId(alert.deliveryTarget)

const configContextIdForDelivery = (deliveryTarget: DeferredExecutionContext['deliveryTarget']): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(deliveryTarget))

const formatTaskStatus = (status: string | undefined): string => (status === undefined ? '' : ` (${status})`)

const buildAlertSummary = (evaluations: AlertEvaluation[]): string =>
  evaluations
    .map(({ alert, newMatchedTasks }) => {
      const taskList = newMatchedTasks.map((t) => `- [${t.title}](${t.url})${formatTaskStatus(t.status)}`).join('\n')
      return `Alert condition: ${describeCondition(alert.condition)}\n${taskList}`
    })
    .join('\n\n')

const mergeAlertPrompts = (evaluations: AlertEvaluation[]): string =>
  evaluations.length === 1
    ? evaluations[0]!.alert.prompt
    : evaluations.map((e, i) => `${String(i + 1)}. "${e.alert.prompt}"`).join('\n')

function markAlertsDelivered(evaluations: AlertEvaluation[], now: string, emitNotifications: boolean): void {
  for (const { alert, matchedNow } of evaluations) {
    updateAlertMatchState(alert.id, alert.createdByUserId, now, matchedNow)
    log.info({ id: alert.id, userId: alert.createdByUserId, matchedCount: matchedNow.length }, 'Alert triggered')
    if (emitNotifications) {
      emitUser('deferred:alerted', alert.createdByUserId, { promptId: alert.id })
      emitUser('notify:deferred_alert', alert.createdByUserId, { promptId: alert.id })
    }
  }
}

async function fireAlertBatch(
  storageContextId: string,
  evaluations: AlertEvaluation[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<boolean> {
  const first = evaluations[0]!.alert
  const execCtx = alertToExecCtx(first)
  if (resolveProactivePlatformInstanceId(chat, first.deliveryTarget) === null) return false
  const now = new Date().toISOString()
  let response: string
  try {
    response = await dispatchExecution(
      execCtx,
      'alert',
      mergeAlertPrompts(evaluations),
      mergeExecutionMetadata(evaluations.map((e) => e.alert)),
      buildProviderFn,
      buildAlertSummary(evaluations),
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { userId: first.createdByUserId, alertIds: evaluations.map((e) => e.alert.id), error: errMsg },
      'Alert prompt execution failed before delivery',
    )
    const errText = `Sorry, something went wrong while preparing this update: ${errMsg}`
    const errDelivered = await sendProactiveMessage(chat, first.deliveryTarget, errText)
    if (!errDelivered) return false
    recordProactiveInHistory(storageContextId, errText)
    markAlertsDelivered(evaluations, now, false)
    return true
  }

  const delivered = await sendProactiveMessage(chat, first.deliveryTarget, response)
  if (!delivered) return false
  markAlertsDelivered(evaluations, now, true)
  return true
}

async function executeAlertsForContext(
  alerts: AlertPrompt[],
  tasks: Task[],
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const storageContextId = getStorageContextId(alerts[0]!.deliveryTarget)
  const snapshots = getSnapshotsForUser(storageContextId)

  const firing: AlertEvaluation[] = []
  for (const alert of alerts) {
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    const previous = new Set(alert.matchedTaskIds)
    const newMatchedTasks = matchedTasks.filter((t) => !previous.has(t.id))
    if (newMatchedTasks.length === 0) {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    } else {
      firing.push({ alert, matchedNow, newMatchedTasks })
    }
  }

  const delivered = firing.length === 0 ? true : await fireAlertBatch(storageContextId, firing, chat, buildProviderFn)
  if (delivered) updateSnapshots(storageContextId, tasks)
}

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
  if (tasks.length > 0 && alertsNeedFullTasks(alerts)) {
    log.debug({ userId, taskCount: tasks.length }, 'Enriching tasks with full details for alert conditions')
    tasks = await enrichTasks(provider, tasks)
  }

  await executeAlertsForContext(alerts, tasks, chat, buildProviderFn, evalNow)
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
