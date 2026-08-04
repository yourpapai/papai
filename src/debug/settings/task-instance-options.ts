// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskInstancesSafe } from '../../instances/task-store.js'

/**
 * A task instance offered to the settings UI as a binding target. Unlike the
 * client schema, `name` is required: the server is the layer that guarantees a
 * human-readable label exists, so the UI never has to render a primary key.
 */
export interface TaskInstanceOption {
  id: string
  type: string
  status: string
  name: string
}

/** Friendly names for the provider types the codebase knows (src/instances/context-store.ts:19-25). */
const TYPE_LABELS: Record<string, string> = { kaneo: 'Kaneo', youtrack: 'YouTrack' }

/**
 * Display label for a task instance. `config` is a free-form decrypted blob and
 * `task_instances` has no name column, so `baseUrl` is absent for any provider
 * without a configurable URL. The fallback derives only from `type` and `id`,
 * both immutable, so a given instance's label never changes underneath a user.
 */
export function taskInstanceLabel(id: string, type: string, baseUrl: string | undefined): string {
  if (baseUrl !== undefined && baseUrl !== '') return baseUrl
  return `${TYPE_LABELS[type] ?? type} instance (${id})`
}

/** Active task instances offered as binding targets; unreadable rows are excluded. */
export function listActiveTaskInstanceOptions(): TaskInstanceOption[] {
  return listTaskInstancesSafe()
    .instances.filter((taskInstance) => taskInstance.status === 'active')
    .map((taskInstance) => ({
      id: taskInstance.id,
      type: taskInstance.type,
      status: taskInstance.status,
      name: taskInstanceLabel(taskInstance.id, taskInstance.type, taskInstance.config['baseUrl']),
    }))
}
