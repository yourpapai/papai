import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { GlobalSearchResponseSchema, SearchTaskSchema, type GlobalSearchResponse } from './schemas/global-search.js'

const log = logger.child({ scope: 'kaneo:search-tasks' })

// Simplified task result schema for search results (output shape, not API shape)
export const TaskResultSchema = SearchTaskSchema.pick({
  id: true,
  title: true,
  number: true,
  status: true,
  priority: true,
  projectId: true,
}).extend({
  userId: z.string(),
})

export const KaneoSearchResponseSchema = GlobalSearchResponseSchema

export type TaskResult = z.infer<typeof TaskResultSchema>

export function flattenGroupedTaskSearchResults(result: GlobalSearchResponse): TaskResult[] {
  return result.tasks.map((task) => {
    const priorityParsed = TaskResultSchema.shape.priority.safeParse(task.priority)

    return {
      id: task.id,
      title: task.title,
      number: task.number ?? 0,
      status: task.status,
      priority: priorityParsed.success ? priorityParsed.data : 'no-priority',
      projectId: task.projectId,
      userId: task.userId ?? '',
    }
  })
}

function filterAndPaginateTaskSearchResults(
  tasks: readonly TaskResult[],
  assigneeId: string | undefined,
  limit: number | undefined,
  offset: number | undefined,
): TaskResult[] {
  if (assigneeId === undefined) {
    return [...tasks]
  }

  const filteredTasks = tasks.filter((task) => task.userId === assigneeId)
  const start = offset ?? 0

  return limit === undefined ? filteredTasks.slice(start) : filteredTasks.slice(start, start + limit)
}

export async function searchTasks({
  config,
  query,
  workspaceId,
  projectId,
  assigneeId,
  limit,
  offset,
}: {
  config: KaneoConfig
  query: string
  workspaceId: string
  projectId?: string
  assigneeId?: string
  limit?: number
  offset?: number
}): Promise<TaskResult[]> {
  log.debug({ query, workspaceId, projectId, assigneeId, limit, offset }, 'searchTasks called')

  try {
    const client = new KaneoClient(config)
    const result = await client.tasks.search({ query, workspaceId, projectId, assigneeId, limit, offset })
    const tasks = filterAndPaginateTaskSearchResults(
      flattenGroupedTaskSearchResults(result),
      assigneeId,
      limit,
      offset,
    )
    log.info({ query, resultCount: tasks.length, assigneeId }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
