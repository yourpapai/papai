// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { runWithProviderRequestScope } from '../analytics/provider-request-scope.js'
import type { ProviderRequestScope } from '../analytics/provider-request-scope.js'
import { resolveProactiveProviderRequestScope } from '../analytics/provider-scope-factory.js'
import type { ProactiveScopeInput } from '../analytics/provider-scope-factory.js'
import type { ChatProvider } from '../chat/types.js'
import { emitGlobal, emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import { recordProactiveInHistory } from '../proactive-history.js'
import type { Activity, Task, TaskProvider } from '../providers/types.js'
import { getActiveAlertPrompts, getEligibleAlertPrompts, updateAlertMatchState } from './alerts.js'
import { hasTaskChanges, LIGHTWEIGHT_SNAPSHOT_FIELDS, RICH_SNAPSHOT_FIELDS } from './change-gate.js'
import { isPureActivityCondition, isPureWatchCondition } from './condition-eval.js'
import { fetchAlertTasks } from './fetch-tasks.js'
import {
  commitActivityBaseline,
  evaluateActivityAlert,
  markActivityDelivered,
  type ActivityEvaluation,
} from './poller-alerts-activity.js'
import {
  groupAlertsByInstance,
  handleUnresolvableProvider,
  routableContextGroups,
  type InstanceAlertGroup,
} from './poller-alerts-grouping.js'
import { buildBatchSummary, mergeAlertPrompts } from './poller-alerts-summary.js'
import type { AlertEvaluation } from './poller-alerts-watch.js'
import { collectFieldFirings, collectPureWatchFiring, needsFirstCycleBaseline } from './poller-alerts-watch.js'
import { mergeExecutionMetadata } from './poller-scheduled.js'
import { resolveProactivePlatformInstanceId, sendProactiveMessage } from './proactive-delivery.js'
import { dispatchExecution, type BuildProviderFn, type DeferredExecutionContext } from './proactive-llm.js'
import { getSnapshotsForUser, updateSnapshots } from './snapshots.js'
import type { AlertPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:poller:alerts' })

export const MAX_CONCURRENT_USERS = 10
export const MAX_CONCURRENT_LLM_CALLS = 5

export function logSettledErrors(results: PromiseSettledResult<unknown>[], context: string): void {
  for (const r of results) {
    if (r.status === 'rejected') log.error({ error: String(r.reason) }, context)
  }
}

const alertToExecCtx = (alert: AlertPrompt): DeferredExecutionContext => ({
  createdByUserId: alert.createdByUserId,
  deliveryTarget: alert.deliveryTarget,
})

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
  evaluations: Array<AlertEvaluation | ActivityEvaluation>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
): Promise<boolean> {
  const first = evaluations[0]!.alert
  const execCtx = alertToExecCtx(first)
  if (resolveProactivePlatformInstanceId(chat, first.deliveryTarget) === null) return false
  const now = new Date().toISOString()
  const fieldEvaluations = evaluations.filter((e): e is AlertEvaluation => 'newMatchedTasks' in e)
  const activityEvaluations = evaluations.filter((e): e is ActivityEvaluation => !('newMatchedTasks' in e))
  let response: string
  try {
    response = await dispatchExecution(
      execCtx,
      'alert',
      mergeAlertPrompts(evaluations),
      mergeExecutionMetadata(evaluations.map((e) => e.alert)),
      buildProviderFn,
      buildBatchSummary(evaluations),
    )
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error)
    log.error(
      { userId: first.createdByUserId, alertIds: evaluations.map((e) => e.alert.id), error: errMsg },
      'Alert prompt execution failed before delivery',
    )
    // Activity firings keep their cursor on failure so the entries retry on
    // the next poll instead of being lost; a pure-activity batch therefore
    // sends no error chatter either.
    if (fieldEvaluations.length === 0) return false
    const errText = `Sorry, something went wrong while preparing this update: ${errMsg}`
    const errDelivered = await sendProactiveMessage(chat, first.deliveryTarget, errText)
    if (!errDelivered) return false
    recordProactiveInHistory(storageContextId, errText)
    markAlertsDelivered(fieldEvaluations, now, false)
    return true
  }

  const delivered = await sendProactiveMessage(chat, first.deliveryTarget, response)
  if (!delivered) return false
  markAlertsDelivered(fieldEvaluations, now, true)
  markActivityDelivered(activityEvaluations, now, true)
  return true
}

async function executeAlertsForContext(
  storageContextId: string,
  alerts: AlertPrompt[],
  lightTasks: Task[],
  enrichedTasks: Task[] | null,
  historyByTask: ReadonlyMap<string, Activity[]>,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
  pureWatch: boolean,
): Promise<void> {
  const snapshots = getSnapshotsForUser(storageContextId)
  const activityAlerts = alerts.filter((alert) => isPureActivityCondition(alert.condition))
  const fieldAlerts = alerts.filter((alert) => !isPureActivityCondition(alert.condition))
  const firing: Array<AlertEvaluation | ActivityEvaluation> = []
  for (const alert of activityAlerts) {
    const evaluation = evaluateActivityAlert(alert, historyByTask)
    commitActivityBaseline(evaluation)
    if (evaluation.firingEntries.length > 0) firing.push(evaluation)
  }

  let tasks: Task[] = lightTasks
  let fields: readonly string[] = RICH_SNAPSHOT_FIELDS
  let snapshotEligible = false
  if (pureWatch) {
    tasks = lightTasks
    fields = RICH_SNAPSHOT_FIELDS
    firing.push(...collectPureWatchFiring(fieldAlerts, tasks, snapshots, evalNow, fields))
    snapshotEligible = fieldAlerts.length > 0
  } else if (fieldAlerts.length > 0) {
    // Rich-vs-lightweight follows what the instance cycle actually fetched
    // (enrichment is instance-level), not this context's own condition scan:
    // a watch sharing the instance with a rich-field alert in another
    // context must also count assignee/labels changes (spec: task-watch-alerts).
    tasks = enrichedTasks ?? lightTasks
    fields = enrichedTasks === null ? LIGHTWEIGHT_SNAPSHOT_FIELDS : RICH_SNAPSHOT_FIELDS
    if (hasTaskChanges(tasks, snapshots, fields) || needsFirstCycleBaseline(fieldAlerts)) {
      snapshotEligible = true
      firing.push(...collectFieldFirings(fieldAlerts, tasks, snapshots, evalNow, fields))
    }
  }

  const delivered = firing.length === 0 ? true : await fireAlertBatch(storageContextId, firing, chat, buildProviderFn)
  if (delivered && snapshotEligible) updateSnapshots(storageContextId, tasks, fields)
}

/** Partition domain is the routable context groups only (spec:
 * task-watch-alerts): alerts in non-routable groups are never evaluated, so
 * they must not keep the instance on the whole-list path. A targeted
 * instance is one whose every alert is a pure watch or a pure activity
 * watch — neither needs the whole task list. */
const allAlertsTargeted = (group: InstanceAlertGroup, chat: ChatProvider): boolean =>
  [...routableContextGroups(group.contextGroups, chat).values()]
    .flat()
    .every((alert) => isPureWatchCondition(alert.condition) || isPureActivityCondition(alert.condition))

const instanceNeedsHistory = (routable: Map<string, AlertPrompt[]>): boolean =>
  [...routable.values()].flat().some((alert) => isPureActivityCondition(alert.condition))

/** One independent proactive scope per instance poll, built from the first
 * alert's owner and delivery target. Provider construction and every
 * task-list/detail request settle inside this awaited scope lease. Returns
 * null (after handling) when the provider cannot be resolved. */
async function buildInstanceProvider(
  routable: Map<string, AlertPrompt[]>,
  configContextId: string,
  pinnedTaskInstanceId: string | null,
  buildProviderFn: BuildProviderFn,
  resolveScope: (input: ProactiveScopeInput) => ProviderRequestScope,
): Promise<{ provider: TaskProvider; scope: ProviderRequestScope; pinned: BuildProviderFn } | null> {
  const firstAlert = [...routable.values()][0]![0]!
  const scope = resolveScope({
    createdByUserId: firstAlert.createdByUserId,
    deliveryTarget: firstAlert.deliveryTarget,
  })
  const pinned: BuildProviderFn = (contextId) => buildProviderFn(contextId, pinnedTaskInstanceId)
  const provider = await runWithProviderRequestScope(scope, () => pinned(configContextId))
  if (provider === null) {
    handleUnresolvableProvider(configContextId, pinnedTaskInstanceId)
    return null
  }
  return { provider, scope, pinned }
}

/** One poll unit: every alert sharing a config context and an effective task
 * instance. `pinnedTaskInstanceId` is null when the instance comes from the
 * context's current settings rather than an alert pin. */
async function executeAlertsForInstance(
  group: InstanceAlertGroup,
  targeted: boolean,
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  evalNow: Date,
  resolveScope: (input: ProactiveScopeInput) => ProviderRequestScope,
): Promise<void> {
  const { configContextId, pinnedTaskInstanceId, contextGroups } = group
  const routable = routableContextGroups(contextGroups, chat)
  if (routable.size === 0) return

  const resolved = await buildInstanceProvider(
    routable,
    configContextId,
    pinnedTaskInstanceId,
    buildProviderFn,
    resolveScope,
  )
  if (resolved === null) return
  const { provider, scope, pinned: pinnedBuildProviderFn } = resolved

  const needHistory = instanceNeedsHistory(routable)
  const fetched = await fetchAlertTasks(configContextId, routable, provider, scope, targeted, needHistory)
  if (fetched === null) return
  const { lightTasks, enrichedTasks, pureWatch, historyByTask } = fetched

  const contextLimit = pLimit(MAX_CONCURRENT_LLM_CALLS)
  await Promise.all(
    [...routable.entries()].map(([storageContextId, alerts]) =>
      contextLimit(() =>
        executeAlertsForContext(
          storageContextId,
          alerts,
          lightTasks,
          enrichedTasks,
          historyByTask,
          chat,
          pinnedBuildProviderFn,
          evalNow,
          pureWatch,
        ),
      ),
    ),
  )
}

export type PollAlertsDeps = Readonly<{
  resolveScope: (input: ProactiveScopeInput) => ProviderRequestScope
}>

const defaultPollAlertsDeps: PollAlertsDeps = { resolveScope: resolveProactiveProviderRequestScope }

export async function pollAlertsOnce(
  chat: ChatProvider,
  buildProviderFn: BuildProviderFn,
  deps: PollAlertsDeps = defaultPollAlertsDeps,
): Promise<void> {
  log.debug('pollAlertsOnce called')
  const eligibleAlerts = getEligibleAlertPrompts()
  emitGlobal('poller:alerts', { eligibleCount: eligibleAlerts.length })
  if (eligibleAlerts.length === 0) return
  const now = new Date()
  const byInstance = groupAlertsByInstance(eligibleAlerts)
  // Partition on the full active alert set, not the cooldown-eligible subset:
  // an alert entering cooldown must not flip the instance's fetch mode
  // mid-life (design D4), or rich getTask results get compared against
  // lightweight-era snapshots and non-watched snapshot rows get pruned.
  const activeByInstance = groupAlertsByInstance(getActiveAlertPrompts())
  const userLimit = pLimit(MAX_CONCURRENT_USERS)
  const results = await Promise.allSettled(
    [...byInstance.entries()].map(([instanceKey, instanceGroup]) =>
      userLimit((): Promise<void> =>
        executeAlertsForInstance(
          instanceGroup,
          allAlertsTargeted(activeByInstance.get(instanceKey) ?? instanceGroup, chat),
          chat,
          buildProviderFn,
          now,
          deps.resolveScope,
        ),
      ),
    ),
  )
  logSettledErrors(results, 'Error polling alerts for instance')
}
