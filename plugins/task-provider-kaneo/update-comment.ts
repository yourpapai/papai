// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:update-comment' })

export async function updateComment({
  config,
  taskId,
  activityId,
  comment,
}: {
  config: KaneoConfig
  taskId: string
  activityId: string
  comment: string
}): Promise<{ id: string; comment: string; createdAt: string }> {
  log.debug({ taskId, commentId: activityId, commentLength: comment.length }, 'updateComment called')

  try {
    const client = new KaneoClient(config)
    const result = await client.comments.update(taskId, activityId, comment)
    log.info({ taskId, commentId: activityId }, 'Comment updated')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), commentId: activityId },
      'updateComment failed',
    )
    throw classifyKaneoError(error)
  }
}
