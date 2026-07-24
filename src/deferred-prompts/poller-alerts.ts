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
import { hasTaskChanges, LIGHTWEIGHT_SNAPSHOT_FIELDS, RICH_SNAPSHOT_FIELDS } from './change-gate.js'
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
  storageContextId: string,
  alerts: AlertPrompt[],
  lightTasks: Task[],
  enrichedTasks: Task[] | null,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const needsRich = alertsNeedFullTasks(alerts)
  const tasks = needsRich && enrichedTasks !== null ? enrichedTasks : lightTasks
  const snapshots = getSnapshotsForUser(storageContextId)
  const fields = needsRich ? RICH_SNAPSHOT_FIELDS : LIGHTWEIGHT_SNAPSHOT_FIELDS
  if (!hasTaskChanges(tasks, snapshots, fields)) {
    log.debug({ storageContextId }, 'No task changes detected; skipping alert evaluation')
    return
  }

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

async function executeAlertsForInstance(
  configContextId: string,
  contextGroups: Map<string, AlertPrompt[]>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
): Promise<void> {
  const routable = new Map<string, AlertPrompt[]>()
  for (const [storageContextId, alerts] of contextGroups) {
    if (resolveProactivePlatformInstanceId(chat, alerts[0]!.deliveryTarget) !== null) {
      routable.set(storageContextId, alerts)
    }
  }
  if (routable.size === 0) return

  const provider = await buildProviderFn(configContextId)
  if (provider === null) {
    log.warn({ configContextId }, 'Could not build task provider for alert polling')
    return
  }

  const lightTasks = await fetchAllTasks(provider)
  const needsEnrichment = [...routable.values()].some((alerts) => alertsNeedFullTasks(alerts))
  let enrichedTasks: Task[] | null = null
  if (needsEnrichment && lightTasks.length > 0) {
    try {
      log.debug(
        { configContextId, taskCount: lightTasks.length },
        'Enriching tasks with full details for alert conditions',
      )
      enrichedTasks = await enrichTasks(provider, lightTasks)
    } catch (error) {
      log.warn(
        { configContextId, error: error instanceof Error ? error.message : String(error) },
        'Task enrichment failed; skipping alert cycle for instance',
      )
      return
    }
  }

  await Promise.all(
    [...routable.entries()].map(([storageContextId, alerts]) =>
      executeAlertsForContext(storageContextId, alerts, lightTasks, enrichedTasks, chat, buildProviderFn, evalNow),
    ),
  )
}

export async function pollAlertsOnce(chat: ChatProvider, buildProviderFn: BuildProviderFn): Promise<void> {
  log.debug('pollAlertsOnce called')
  const eligibleAlerts = getEligibleAlertPrompts()
  emitGlobal('poller:alerts', { eligibleCount: eligibleAlerts.length })
  if (eligibleAlerts.length === 0) return
  const now = new Date()
  const byInstance = new Map<string, Map<string, AlertPrompt[]>>()
  for (const alert of eligibleAlerts) {
    const storageContextId = alertDeliveryContextKey(alert)
    const configContextId = configContextIdForDelivery(alert.deliveryTarget)
    let contextGroups = byInstance.get(configContextId)
    if (contextGroups === undefined) {
      contextGroups = new Map()
      byInstance.set(configContextId, contextGroups)
    }
    const group = contextGroups.get(storageContextId)
    if (group === undefined) contextGroups.set(storageContextId, [alert])
    else group.push(alert)
  }
  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byInstance.entries()].map(([configContextId, contextGroups]) =>
      userLimit(
        (): Promise<void> => executeAlertsForInstance(configContextId, contextGroups, chat, buildProviderFn, now),
      ),
    ),
  )
  logSettledErrors(results, 'Error polling alerts for user')
}
