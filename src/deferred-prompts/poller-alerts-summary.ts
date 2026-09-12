// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { wrapUntrusted } from '../security/prompt-boundary.js'
import { describeCondition } from './alerts.js'
import { buildActivitySummary, EXTERNAL_DATA_FRAMING, type ActivityEvaluation } from './poller-alerts-activity.js'
import type { AlertEvaluation } from './poller-alerts-watch.js'

const formatTaskStatus = (status: string | undefined): string => {
  const wrapped = wrapUntrusted(status, 'task-status')
  return wrapped === '' ? '' : ` (${wrapped})`
}

export const buildAlertSummary = (evaluations: AlertEvaluation[]): string =>
  `${EXTERNAL_DATA_FRAMING}\n${evaluations
    .map(({ alert, newMatchedTasks }) => {
      const taskList = newMatchedTasks
        .map(
          (t) =>
            `- ${wrapUntrusted(t.title, 'task-title')} (${wrapUntrusted(t.url, 'task-url')})${formatTaskStatus(t.status)}`,
        )
        .join('\n')
      return `Alert condition: ${describeCondition(alert.condition)}\n${taskList}`
    })
    .join('\n\n')}`

export const mergeAlertPrompts = (evaluations: ReadonlyArray<AlertEvaluation | ActivityEvaluation>): string =>
  evaluations.length === 1
    ? evaluations[0]!.alert.prompt
    : evaluations.map((e, i) => `${String(i + 1)}. "${e.alert.prompt}"`).join('\n')

export const buildBatchSummary = (evaluations: ReadonlyArray<AlertEvaluation | ActivityEvaluation>): string => {
  const fieldEvaluations = evaluations.filter((e): e is AlertEvaluation => 'newMatchedTasks' in e)
  const activityEvaluations = evaluations.filter((e): e is ActivityEvaluation => !('newMatchedTasks' in e))
  const parts: string[] = []
  if (fieldEvaluations.length > 0) parts.push(buildAlertSummary(fieldEvaluations))
  if (activityEvaluations.length > 0) parts.push(buildActivitySummary(activityEvaluations))
  return parts.join('\n\n')
}
