import { logger } from '../../logger.js'
import type { RelationType } from '../types.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-task-relation' })

export async function updateTaskRelation({
  config,
  taskId,
  relatedTaskId,
  type,
}: {
  config: KaneoConfig
  taskId: string
  relatedTaskId: string
  type: RelationType
}): Promise<{ taskId: string; relatedTaskId: string; type: string }> {
  log.debug({ taskId, relatedTaskId, type }, 'updateTaskRelation called')

  try {
    const client = new KaneoClient(config)
    const result = await client.tasks.updateRelation(taskId, relatedTaskId, type)
    log.info({ taskId, relatedTaskId, type }, 'Relation updated')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId },
      'updateTaskRelation failed',
    )
    throw classifyKaneoError(error)
  }
}
