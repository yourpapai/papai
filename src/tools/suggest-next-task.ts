// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import pLimit from 'p-limit'
import { z } from 'zod'

import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import { getConfig } from '../config.js'
import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import type { ListTasksParams, TaskProvider } from '../providers/types.js'
import type { RankedTask, RankableTask } from './suggest-next-task-ranking.js'
import { rankTasks } from './suggest-next-task-ranking.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:suggest-next-task' })

const suggestInputSchema = z.object({
  projectId: z.string().optional().describe('Restrict candidates to one project; defaults to all projects'),
  assigneeId: z.string().optional().describe('Filter by assignee user ID; the literal "me" resolves to your identity'),
  limit: z.number().int().min(1).max(5).optional().describe('Max suggestions to return (1-5, default 3)'),
})

/** Per-project list params for candidate collection (design D4). */
const CANDIDATE_PARAMS: Readonly<ListTasksParams> = { limit: 50, sortBy: 'dueDate', sortOrder: 'asc' }
const FAN_OUT_CONCURRENCY = 3
const DEFAULT_LIMIT = 3

type SuggestionEntry = {
  id: string
  title: string
  number?: number
  url: string
  projectId: string
  dueDate?: string | null
  priority?: string
  score: number
  reason: string
}

async function resolveAssigneeFilter(
  assigneeId: string | undefined,
  userId: string | undefined,
  provider: TaskProvider,
): Promise<string | undefined | { status: 'identity_required'; message: string }> {
  if (assigneeId === undefined || assigneeId.toLowerCase() !== 'me' || userId === undefined) {
    return assigneeId
  }
  const identity = await resolveMeReference(userId, provider)
  if (identity.type === 'found') {
    return provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
  }
  return { status: 'identity_required', message: identity.message }
}

async function collectCandidates(
  projectId: string | undefined,
  resolvedAssigneeId: string | undefined,
  provider: TaskProvider,
): Promise<Array<{ task: RankableTask; projectId: string }> | { status: 'project_required'; message: string }> {
  const projectIds: string[] = []
  if (projectId !== undefined) {
    projectIds.push(projectId)
  } else if (provider.listProjects === undefined) {
    return {
      status: 'project_required',
      message: 'This task instance cannot list projects. Specify a projectId to rank tasks within one project.',
    }
  } else {
    const projects = await provider.listProjects()
    projectIds.push(...projects.map((project): string => project.id))
  }

  const limit = pLimit(FAN_OUT_CONCURRENCY)
  const listParams: ListTasksParams =
    resolvedAssigneeId === undefined ? { ...CANDIDATE_PARAMS } : { ...CANDIDATE_PARAMS, assigneeId: resolvedAssigneeId }
  const perProject = await Promise.all(
    projectIds.map((id): Promise<Array<{ task: RankableTask; projectId: string }>> =>
      limit(async (): Promise<Array<{ task: RankableTask; projectId: string }>> => {
        const tasks = await provider.listTasks(id, provider.normalizeListTaskParams(listParams))
        return tasks
          .filter((task): boolean => task.resolved === undefined)
          .map((task): { task: RankableTask; projectId: string } => ({ task, projectId: id }))
      }),
    ),
  )
  return perProject.flat()
}

/** Timezone resolution cloned from list-tasks.ts: group-shared config context
 *  (thread suffix stripped), userId fallback, then UTC. */
function resolveOutputTimezone(storageContextId: string | undefined, userId: string | undefined): string {
  const configKey = storageContextId ?? userId
  if (configKey === undefined) return 'UTC'
  return getConfig(getConfigContextIdFromStorageContextId(configKey), 'timezone') ?? 'UTC'
}

function toSuggestion(task: RankedTask, projectId: string, provider: TaskProvider, timezone: string): SuggestionEntry {
  const suggestion: SuggestionEntry = {
    id: task.id,
    title: task.title,
    url: task.url,
    projectId,
    score: task.score,
    reason: task.reason,
  }
  if (task.number !== undefined) suggestion.number = task.number
  if (task.priority !== undefined) suggestion.priority = task.priority
  const dueDate = provider.formatDueDateOutput(task.dueDate, timezone)
  if (dueDate !== undefined && dueDate !== null) suggestion.dueDate = dueDate
  return suggestion
}

function buildSuggestions(
  candidates: Array<{ task: RankableTask; projectId: string }>,
  explicitProjectId: string | undefined,
  suggestionLimit: number,
  provider: TaskProvider,
  timezone: string,
): SuggestionEntry[] {
  const projectIdByTaskId = new Map(candidates.map((entry): [string, string] => [entry.task.id, entry.projectId]))
  return rankTasks(
    candidates.map((entry): RankableTask => entry.task),
    new Date(),
  )
    .slice(0, suggestionLimit)
    .map((ranked): SuggestionEntry =>
      toSuggestion(ranked, projectIdByTaskId.get(ranked.id) ?? explicitProjectId ?? '', provider, timezone),
    )
}

export function makeSuggestNextTaskTool(provider: TaskProvider, userId?: string, storageContextId?: string): Tool {
  return tool({
    description:
      'Suggest what to work on next: a deterministic ranking of open tasks by due-date urgency, priority, and recency, with one-line reasons. Read-only.',
    inputSchema: suggestInputSchema,
    execute: async ({ projectId, assigneeId, limit }) => {
      try {
        log.debug(
          {
            hasProjectId: projectId !== undefined,
            hasAssigneeFilter: assigneeId !== undefined,
            limit,
            hasUserId: userId !== undefined,
          },
          'suggest_next_task called',
        )
        const resolvedAssigneeId = await resolveAssigneeFilter(assigneeId, userId, provider)
        if (typeof resolvedAssigneeId === 'object') {
          log.info({ status: 'identity_required' }, 'suggest_next_task identity resolution failed')
          return resolvedAssigneeId
        }

        const candidates = await collectCandidates(projectId, resolvedAssigneeId, provider)
        if (!Array.isArray(candidates)) {
          log.info({ status: candidates.status }, 'suggest_next_task needs an explicit project')
          return candidates
        }

        const suggestions = buildSuggestions(
          candidates,
          projectId,
          limit ?? DEFAULT_LIMIT,
          provider,
          resolveOutputTimezone(storageContextId, userId),
        )

        log.info({ considered: candidates.length, returned: suggestions.length }, 'suggest_next_task completed')
        return { suggestions, considered: candidates.length }
      } catch (error) {
        log.error(toolFailureMeta('suggest_next_task', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
