// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:remove-task-relation' })

export async function removeTaskRelation({
  config,
  taskId,
  relatedTaskId,
}: {
  config: KaneoConfig
  taskId: string
  relatedTaskId: string
}): Promise<{ taskId: string; relatedTaskId: string; success: true }> {
  log.debug({ taskId, relatedTaskId }, 'removeTaskRelation called')

  try {
    const client = new KaneoClient(config)
    const result = await client.tasks.removeRelation(taskId, relatedTaskId)
    log.info({ taskId, relatedTaskId }, 'Relation removed')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), taskId, relatedTaskId },
      'removeTaskRelation failed',
    )
    throw classifyKaneoError(error)
  }
}
