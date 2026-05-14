import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import type { TaskRelation } from './frontmatter.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:get-task' })

export interface TaskDetails {
  id: string
  title: string
  description: string
  number: number
  status: string
  priority: string
  startDate: string | null
  dueDate: string | null
  createdAt: string
  projectId: string
  userId: string | null
  relations: TaskRelation[]
}

export async function getTask({ config, taskId }: { config: KaneoConfig; taskId: string }): Promise<TaskDetails> {
  log.debug({ taskId }, 'getTask called')

  try {
    const client = new KaneoClient(config)
    const task = await client.tasks.get(taskId)
    log.info({ taskId, number: task.number, relationCount: task.relations.length }, 'Task fetched')
    return task
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'getTask failed')
    throw classifyKaneoError(error, { taskId })
  }
}
