// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { type KaneoConfig, kaneoFetch } from './client.js'
import { TaskSchema, type CreateTaskResponse } from './schemas/create-task.js'
import { type TaskStatusDeps, denormalizeStatus, validateStatus } from './task-status.js'

const log = logger.child({ scope: 'kaneo:task-update-helpers' })

type TaskUpdateParams = {
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string
  startDate?: string
  projectId?: string
  userId?: string
}

type FullUpdateBody = {
  title: string
  description: string
  status: string
  priority: string
  projectId: string
  position: number
  dueDate?: string
  startDate?: string
  userId?: string
}

/**
 * Build the JSON body for `PUT /task/:id` from an existing task plus a patch.
 * Mirrors the official @kaneo/mcp `buildFullTaskUpdateBody` helper:
 * the Kaneo API requires the full task payload on update, so we merge
 * unchanged fields from the existing task.
 */
function requireString(value: string | undefined | null, field: string): string {
  if (value === undefined || value === null || value === '') {
    throw new Error(`Cannot update task: missing ${field}.`)
  }
  return value
}

function buildFullTaskUpdateBody(existing: CreateTaskResponse, patch: TaskUpdateParams): FullUpdateBody {
  const position = existing.position
  if (position === null || !Number.isFinite(position)) {
    throw new Error('Cannot update task: missing numeric `position` on existing task.')
  }

  const body: FullUpdateBody = {
    title: requireString(patch.title ?? existing.title, 'title'),
    description: patch.description ?? existing.description ?? '',
    status: requireString(patch.status ?? existing.status, 'status'),
    priority: requireString(patch.priority ?? existing.priority, 'priority'),
    projectId: requireString(patch.projectId ?? existing.projectId, 'projectId'),
    position,
  }

  const existingDueDate = typeof existing.dueDate === 'string' ? existing.dueDate : undefined
  const dueDate = patch.dueDate ?? existingDueDate
  if (dueDate !== undefined) {
    body.dueDate = dueDate
  }

  const startDate = patch.startDate ?? existing.startDate ?? undefined
  if (startDate !== undefined) {
    body.startDate = startDate
  }

  const userId = patch.userId ?? existing.userId ?? undefined
  if (userId !== undefined) {
    body.userId = userId
  }

  return body
}

/**
 * Fetch the existing task, merge the patch, and PUT the full body to `/task/:id`.
 *
 * This matches the upstream @kaneo/mcp flow — the Kaneo API does not accept
 * partial updates on the main task endpoint, it requires the full payload.
 */
export async function performUpdate(
  config: KaneoConfig,
  taskId: string,
  params: TaskUpdateParams,
  statusDeps?: TaskStatusDeps,
): Promise<CreateTaskResponse> {
  log.debug({ taskId, fields: Object.keys(params) }, 'performUpdate called')

  const existing = await kaneoFetch(config, 'GET', `/task/${taskId}`, undefined, undefined, TaskSchema)

  const patch: TaskUpdateParams = { ...params }
  if (patch.status !== undefined) {
    patch.status = await validateStatus(config, existing.projectId, patch.status, statusDeps)
  }

  const body = buildFullTaskUpdateBody(existing, patch)
  const updated = await kaneoFetch(config, 'PUT', `/task/${taskId}`, body, undefined, TaskSchema)

  updated.status = await denormalizeStatus(config, updated.projectId, updated.status, statusDeps)
  log.info({ taskId, number: updated.number }, 'Task updated')
  return updated
}
