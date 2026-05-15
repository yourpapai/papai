// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { Task, TaskProvider } from '../providers/types.js'
import type { AlertCondition } from './types.js'

const log = logger.child({ scope: 'deferred:fetch-tasks' })

/** Fields that require a full getTask call (not available in TaskListItem). */
const FIELDS_REQUIRING_FULL_TASK = new Set(['task.assignee', 'task.labels'])

/** Extract all field names referenced by a condition tree. */
const extractFields = (condition: AlertCondition): Set<string> => {
  const fields = new Set<string>()
  const walk = (c: AlertCondition): void => {
    if ('and' in c) {
      for (const child of c.and) walk(child)
    } else if ('or' in c) {
      for (const child of c.or) walk(child)
    } else {
      fields.add(c.field)
    }
  }
  walk(condition)
  return fields
}

/** Check whether any alert condition references fields that TaskListItem doesn't have. */
export function alertsNeedFullTasks(alerts: ReadonlyArray<{ condition: AlertCondition }>): boolean {
  for (const alert of alerts) {
    for (const field of extractFields(alert.condition)) {
      if (FIELDS_REQUIRING_FULL_TASK.has(field)) return true
    }
  }
  return false
}

/** Fetch all tasks via listProjects + listTasks (preferred). */
async function fetchViaProjects(provider: TaskProvider): Promise<Task[]> {
  const projects = await provider.listProjects!()
  const tasksByProject = await Promise.all(
    projects.map(async (project) => {
      const items = await provider.listTasks(project.id)
      return { projectId: project.id, items }
    }),
  )

  const allItems = tasksByProject.flatMap(({ projectId, items }) => items.map((item) => ({ ...item, projectId })))
  log.debug({ projectCount: projects.length, taskCount: allItems.length }, 'Fetched tasks across all projects')

  return allItems.map(
    (item): Task => ({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      dueDate: item.dueDate,
      projectId: item.projectId,
      url: item.url,
    }),
  )
}

/** Fallback: fetch tasks via searchTasks when listProjects is unavailable. */
async function fetchViaSearch(provider: TaskProvider): Promise<Task[]> {
  log.warn('Provider does not support listProjects; falling back to searchTasks')
  const results = await provider.searchTasks({ query: '' })
  log.debug({ taskCount: results.length }, 'Fetched tasks via searchTasks fallback')

  return results.map(
    (item): Task => ({
      id: item.id,
      title: item.title,
      status: item.status,
      priority: item.priority,
      projectId: item.projectId,
      url: item.url,
    }),
  )
}

/** Fetch all tasks for alert evaluation. Uses listProjects+listTasks if available, searchTasks as fallback. */
export function fetchAllTasks(provider: TaskProvider): Promise<Task[]> {
  if (provider.listProjects !== undefined && provider.capabilities.has('projects.list')) {
    return fetchViaProjects(provider)
  }
  return fetchViaSearch(provider)
}

/** Enrich lightweight tasks with full details via getTask (only when conditions need it). */
export async function enrichTasks(provider: TaskProvider, tasks: Task[]): Promise<Task[]> {
  const results = await Promise.allSettled(tasks.map((t) => provider.getTask(t.id)))
  return results.filter((r): r is PromiseFulfilledResult<Task> => r.status === 'fulfilled').map((r) => r.value)
}
