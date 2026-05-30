// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { RelationType } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
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
