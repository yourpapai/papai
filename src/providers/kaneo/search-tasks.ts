import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { GlobalSearchResponseGroupedCompatSchema } from './schemas/api-compat.js'
import { SearchTaskSchema } from './schemas/global-search.js'

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

export const KaneoSearchResponseSchema = GlobalSearchResponseGroupedCompatSchema

export type TaskResult = z.infer<typeof TaskResultSchema>

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
    const tasks = await client.tasks.search({ query, workspaceId, projectId, assigneeId, limit, offset })
    log.info({ query, resultCount: tasks.length, assigneeId }, 'Tasks searched')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), query }, 'searchTasks failed')
    throw classifyKaneoError(error)
  }
}
