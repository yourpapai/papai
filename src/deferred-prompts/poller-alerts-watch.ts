// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Task } from '../providers/types.js'
import { evaluateCondition, updateAlertMatchedTaskIds } from './alerts.js'
import { SNAPSHOT_FIELDS } from './snapshots.js'
import type { AlertPrompt } from './types.js'

export type AlertEvaluation = {
  alert: AlertPrompt
  matchedNow: string[]
  newMatchedTasks: Task[]
}

const hasStoredSnapshot = (task: Task, snapshots: Map<string, string>): boolean =>
  SNAPSHOT_FIELDS.some(({ field }) => snapshots.has(`${task.id}:${field}`))

/** Pure-watch change test: a task with no stored snapshot is a baseline
 * sighting (reports unchanged so the first cycle only records state); after
 * that, any snapshot-visible field difference reports changed. */
export const watchTaskChanged = (task: Task, snapshots: Map<string, string>): boolean => {
  if (!hasStoredSnapshot(task, snapshots)) return false
  for (const { field, extract } of SNAPSHOT_FIELDS) {
    const current = extract(task)
    const previous = snapshots.get(`${task.id}:${field}`)
    if (current === null && previous === undefined) continue
    if (current !== previous) return true
  }
  return false
}

/** Pure-watch evaluation: an alert fires when a task it matches has a
 * snapshot-visible change; matched-set bookkeeping is kept for non-firing
 * cycles. Missing watched tasks simply match nothing and never fire. */
export function collectPureWatchFiring(
  alerts: AlertPrompt[],
  tasks: Task[],
  snapshots: Map<string, string>,
  evalNow: Date,
): AlertEvaluation[] {
  const firing: AlertEvaluation[] = []
  for (const alert of alerts) {
    const matchedTasks = tasks.filter((task) => evaluateCondition(alert.condition, task, snapshots, evalNow))
    const matchedNow = matchedTasks.map((t) => t.id)
    if (matchedTasks.some((task) => watchTaskChanged(task, snapshots))) {
      firing.push({ alert, matchedNow, newMatchedTasks: matchedTasks })
    } else {
      updateAlertMatchedTaskIds(alert.id, alert.createdByUserId, matchedNow)
    }
  }
  return firing
}
