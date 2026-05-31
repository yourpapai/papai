// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ListTasksParams } from 'papai/plugin-types'

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:list-tasks' })

// Task list item type matching what list() returns
export interface KaneoTaskListItem {
  id: string
  title: string
  number: number
  status: string
  priority: string
  dueDate: string | null
}

export async function listTasks({
  config,
  projectId,
  params,
}: {
  config: KaneoConfig
  projectId: string
  params?: ListTasksParams
}): Promise<KaneoTaskListItem[]> {
  log.debug({ projectId, params }, 'listTasks called')

  try {
    const client = new KaneoClient(config)
    const tasks = await client.tasks.list(projectId, params)
    log.info({ projectId, taskCount: tasks.length }, 'Tasks listed')
    return tasks
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listTasks failed')
    throw classifyKaneoError(error)
  }
}
