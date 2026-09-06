// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Task } from '../providers/types.js'
import { evaluateCondition, updateAlertBaseline, updateAlertMatchedTaskIds } from './alerts.js'
import { RICH_SNAPSHOT_FIELDS } from './change-gate.js'
import { isPureWatchCondition } from './condition-eval.js'
import { SNAPSHOT_FIELDS, TRACKED_FIELDS_ROW } from './snapshots.js'
import type { AlertPrompt } from './types.js'

export type AlertEvaluation = {
  alert: AlertPrompt
  matchedNow: string[]
  newMatchedTasks: Task[]
}

const fieldsToCompare = (fields: readonly string[]): Array<{ field: string; extract: (task: Task) => string | null }> =>
  SNAPSHOT_FIELDS.filter(({ field }) => fields.includes(field))

const trackedAtLastWrite = (snapshots: Map<string, string>, taskId: string, field: string): boolean =>
  (snapshots.get(`${taskId}:${TRACKED_FIELDS_ROW}`) ?? '').split(',').includes(field)

/** Pure-watch change test: a task with no stored snapshot is a baseline
 * sighting (reports unchanged so the first cycle only records state); after
 * that, any difference on the given snapshot field names reports changed.
 * Restricting the field set keeps unenriched tasks from comparing
 * assignee/labels against rich stored snapshots. A field with no stored row
 * counts as a difference only when the last write tracked it (absence is how
 * null is stored); a field outside the last write's set — e.g. assignee after
 * a lightweight-era write — has no baseline and cannot differ. */
export const watchTaskChanged = (
  task: Task,
  snapshots: Map<string, string>,
  fields: readonly string[] = RICH_SNAPSHOT_FIELDS,
): boolean => {
  const compare = fieldsToCompare(fields)
  if (!compare.some(({ field }) => snapshots.has(`${task.id}:${field}`))) return false
  for (const { field, extract } of compare) {
    const current = extract(task)
    const previous = snapshots.get(`${task.id}:${field}`)
    if (previous === undefined) {
      if (!trackedAtLastWrite(snapshots, task.id, field) || current === null) continue
      return true
    }
    if (current !== previous) return true
  }
  return false
}

/** Whole-list field evaluation: pure watches inside a mixed instance report
 * on snapshot-visible changes; filter alerts baseline once per alert life on
 * their first evaluation cycle (never fired and never baselined → record the
 * matched set, fire nothing — no backlog replay), then fire on the match
 * edge — including the first match after an empty episode, so a drained
 * match set is never re-baselined — and keep matched-set bookkeeping on
 * non-firing cycles. */
export function collectFieldFirings(
  fieldAlerts: AlertPrompt[],
  tasks: Task[],
  snapshots: Map<string, string>,
  evalNow: Date,
  fields: readonly string[],
): AlertEvaluation[] {
  const firing: AlertEvaluation[] = []
  const watchAlerts = fieldAlerts.filter((alert) => isPureWatchCondition(alert.condition))
  firing.push(...collectPureWatchFiring(watchAlerts, tasks, snapshots, evalNow, fields))
  for (const alert of fieldAlerts) {
    if (isPureWatchCondition(alert.condition)) continue
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    const previous = new Set(alert.matchedTaskIds)
    const newMatchedTasks = matchedTasks.filter((t) => !previous.has(t.id))
    if (alert.lastTriggeredAt === null && alert.lastActivityCursor === null) {
      updateAlertBaseline(alert.id, alert.createdByUserId, matchedNow, evalNow.toISOString())
      continue
    }
    if (newMatchedTasks.length === 0) {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    } else {
      firing.push({ alert, matchedNow, newMatchedTasks })
    }
  }
  return firing
}

/** True when some filter alert has never been evaluated: never fired and
 * never baselined (lastActivityCursor doubles as the filter alert's baseline
 * marker). Such an alert must evaluate on its first cycle even when the
 * tracker is quiet — deferring the baseline to the first change would
 * swallow the very first match the alert was created for. Pure watches never
 * set lastActivityCursor, so they are excluded or the change gate would
 * never close again. */
export const needsFirstCycleBaseline = (fieldAlerts: AlertPrompt[]): boolean =>
  fieldAlerts.some(
    (alert) =>
      !isPureWatchCondition(alert.condition) && alert.lastTriggeredAt === null && alert.lastActivityCursor === null,
  )

/** Pure-watch evaluation: an alert fires when a task it matches has a
 * snapshot-visible change; matched-set bookkeeping is kept for non-firing
 * cycles. Missing watched tasks simply match nothing and never fire. */
export function collectPureWatchFiring(
  alerts: AlertPrompt[],
  tasks: Task[],
  snapshots: Map<string, string>,
  evalNow: Date,
  fields: readonly string[] = RICH_SNAPSHOT_FIELDS,
): AlertEvaluation[] {
  const firing: AlertEvaluation[] = []
  for (const alert of alerts) {
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    const changedTasks = matchedTasks.filter((task) => watchTaskChanged(task, snapshots, fields))
    if (changedTasks.length > 0) {
      firing.push({ alert, matchedNow, newMatchedTasks: changedTasks })
    } else {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    }
  }
  return firing
}
