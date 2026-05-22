// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

const log = logger.child({ scope: 'kaneo:list-task-labels' })

type KaneoTaskLabel = z.infer<typeof CreateLabelResponseSchema>

export async function listTaskLabels({
  config,
  taskId,
}: {
  config: KaneoConfig
  taskId: string
}): Promise<KaneoTaskLabel[]> {
  log.debug({ taskId }, 'listTaskLabels called')

  try {
    const client = new KaneoClient(config)
    const labels = await client.labels.listForTask(taskId)
    log.info({ taskId, labelCount: labels.length }, 'Task labels listed')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'listTaskLabels failed')
    throw classifyKaneoError(error)
  }
}
