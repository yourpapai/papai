// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import type { CreateTaskResponse } from './schemas/create-task.js'

const log = logger.child({ scope: 'kaneo:update-task' })

type UpdateParams = {
  title?: string
  description?: string
  status?: string
  priority?: string
  dueDate?: string
  startDate?: string
  projectId?: string
  userId?: string
}

export async function updateTask({
  config,
  taskId,
  ...params
}: UpdateParams & { config: KaneoConfig; taskId: string }): Promise<CreateTaskResponse> {
  log.debug(
    { taskId, status: params.status, priority: params.priority, projectId: params.projectId },
    'updateTask called',
  )

  try {
    const client = new KaneoClient(config)
    const task = await client.tasks.update(taskId, params)
    log.info({ taskId, number: task.number }, 'Task updated')
    return task
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'updateTask failed')
    throw classifyKaneoError(error, { taskId })
  }
}
