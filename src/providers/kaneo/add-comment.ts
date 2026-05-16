// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:add-comment' })

export async function addComment({
  config,
  taskId,
  comment,
}: {
  config: KaneoConfig
  taskId: string
  comment: string
}): Promise<{ id: string; comment: string; createdAt: string }> {
  log.debug({ taskId, commentLength: comment.length }, 'addComment called')

  try {
    const client = new KaneoClient(config)
    const result = await client.comments.add(taskId, comment)
    log.info({ taskId }, 'Comment added')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'addComment failed')
    throw classifyKaneoError(error)
  }
}
