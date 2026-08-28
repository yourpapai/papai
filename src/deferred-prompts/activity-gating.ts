// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { extractActivityTaskIds, isPureActivityCondition } from './condition-eval.js'
import type { AlertCondition } from './types.js'

export const MIXED_ACTIVITY_TREE_ERROR =
  'Activity conditions cannot be combined with field conditions; use an activity watch on its own.'

export const ACTIVITY_UNAVAILABLE_ERROR =
  'Activity alerts are not available: this task tracker does not expose task activity. Use field conditions instead.'

export const ACTIVITY_NO_INSTANCE_ERROR =
  'Activity alerts require a task instance configured for this context. Configure one via /config first.'

/** Shared pure-tree validator: a condition that mentions activity must be a
 * pure activity tree (no field leaves mixed in). Returns null when valid. */
export const mixedActivityTreeError = (condition: AlertCondition): string | null => {
  if (extractActivityTaskIds(condition).length === 0) return null
  return isPureActivityCondition(condition) ? null : MIXED_ACTIVITY_TREE_ERROR
}

/** Create-time activity support check: pure activity conditions additionally
 * need the assembly-time capability flag and a configured task instance for
 * the delivery context. Returns null when supported. */
export const activitySupportError = (
  condition: AlertCondition,
  activityAlertsEnabled: boolean,
  taskInstanceId: string | null,
): string | null => {
  if (extractActivityTaskIds(condition).length === 0) return null
  if (!activityAlertsEnabled) return ACTIVITY_UNAVAILABLE_ERROR
  if (taskInstanceId === null) return ACTIVITY_NO_INSTANCE_ERROR
  return null
}
