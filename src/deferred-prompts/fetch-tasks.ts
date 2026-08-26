// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { runWithProviderRequestScope } from '../analytics/provider-request-scope.js'
import type { ProviderRequestScope } from '../analytics/provider-request-scope.js'
import { logger } from '../logger.js'
import { ProviderClassifiedError } from '../providers/errors.js'
import type { Task, TaskProvider } from '../providers/types.js'
import { extractWatchedTaskIds } from './condition-eval.js'
import type { AlertCondition, AlertPrompt } from './types.js'

const log = logger.child({ scope: 'deferred:fetch-tasks' })

/** Upper bound on concurrent getTask calls when fetching watched tasks. */
const WATCHED_TASK_FETCH_CONCURRENCY = 4

const watchedTaskLimit = pLimit(WATCHED_TASK_FETCH_CONCURRENCY)

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

  return allItems.map((item): Task => ({
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    dueDate: item.dueDate,
    projectId: item.projectId,
    url: item.url,
  }))
}

/** Fallback: fetch tasks via searchTasks when listProjects is unavailable. */
async function fetchViaSearch(provider: TaskProvider): Promise<Task[]> {
  log.warn('Provider does not support listProjects; falling back to searchTasks')
  const results = await provider.searchTasks({ query: '' })
  log.debug({ taskCount: results.length }, 'Fetched tasks via searchTasks fallback')

  return results.map((item): Task => ({
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    projectId: item.projectId,
    url: item.url,
  }))
}

/** Fetch all tasks for alert evaluation. Uses listProjects+listTasks if available, searchTasks as fallback. */
export function fetchAllTasks(provider: TaskProvider, scope: ProviderRequestScope): Promise<Task[]> {
  // Every task-list request settles inside the scope lease; a malformed scope
  // fails (via runWithProviderRequestScope) before any provider method runs.
  return runWithProviderRequestScope(scope, () => {
    if (provider.listProjects !== undefined && provider.capabilities.has('projects.list')) {
      return fetchViaProjects(provider)
    }
    return fetchViaSearch(provider)
  })
}

/** Enrich lightweight tasks with full details via getTask. Rejects if any getTask fails. */
export function enrichTasks(provider: TaskProvider, tasks: Task[], scope: ProviderRequestScope): Promise<Task[]> {
  return runWithProviderRequestScope(scope, () => Promise.all(tasks.map((t) => provider.getTask(t.id))))
}

const isNotFoundCode = (code: string): boolean => code === 'task-not-found' || code === 'not-found'

/** Fetch the given watched tasks by id via getTask with bounded concurrency.
 * Ids whose failure classifies as not-found are skipped with a warn; any other
 * error rejects the whole call. */
export function fetchWatchedTasks(provider: TaskProvider, ids: string[], scope: ProviderRequestScope): Promise<Task[]> {
  return runWithProviderRequestScope(scope, () =>
    Promise.all(
      ids.map((id) =>
        watchedTaskLimit(() =>
          provider.getTask(id).catch((error: unknown) => {
            if (error instanceof ProviderClassifiedError && isNotFoundCode(error.error.code)) {
              log.warn({ taskId: id, code: error.error.code }, 'Watched task not found; skipping')
              return null
            }
            throw error
          }),
        ),
      ),
    ).then((results) => results.filter((task): task is Task => task !== null)),
  )
}

/** Fetch the tasks one instance poll evaluates: a pure-watch instance (every
 * active alert on the instance is a pure watch) targets the deduped watched-id
 * union via getTask; any other instance fetches the whole list, enriched via
 * getTask when some alert condition needs rich fields. */
export async function fetchAlertTasks(
  configContextId: string,
  routable: Map<string, AlertPrompt[]>,
  provider: TaskProvider,
  scope: ProviderRequestScope,
  pureInstance: boolean,
): Promise<{ lightTasks: Task[]; enrichedTasks: Task[] | null; pureWatch: boolean } | null> {
  if (pureInstance) {
    const instanceAlerts = [...routable.values()].flat()
    const watchedIds = [...new Set(instanceAlerts.flatMap((alert) => extractWatchedTaskIds(alert.condition)))]
    log.debug({ configContextId, watchedCount: watchedIds.length }, 'Pure-watch instance; fetching watched tasks by id')
    return { lightTasks: await fetchWatchedTasks(provider, watchedIds, scope), enrichedTasks: null, pureWatch: true }
  }
  const lightTasks = await fetchAllTasks(provider, scope)
  const needsEnrichment = [...routable.values()].some((alerts) => alertsNeedFullTasks(alerts))
  if (!needsEnrichment || lightTasks.length === 0) return { lightTasks, enrichedTasks: null, pureWatch: false }
  try {
    log.debug(
      { configContextId, taskCount: lightTasks.length },
      'Enriching tasks with full details for alert conditions',
    )
    return {
      lightTasks,
      enrichedTasks: await enrichTasks(provider, lightTasks, scope),
      pureWatch: false,
    }
  } catch (error) {
    log.warn(
      { configContextId, error: error instanceof Error ? error.message : String(error) },
      'Task enrichment failed; skipping alert cycle for instance',
    )
    return null
  }
}
