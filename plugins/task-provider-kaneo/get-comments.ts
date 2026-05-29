// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:get-comments' })

export async function getComments({
  config,
  taskId,
}: {
  config: KaneoConfig
  taskId: string
}): Promise<{ id: string; comment: string; createdAt: string }[]> {
  log.debug({ taskId }, 'getComments called')

  try {
    const client = new KaneoClient(config)
    const comments = await client.comments.list(taskId)
    log.info({ taskId, commentCount: comments.length }, 'Comments fetched')
    return comments
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), taskId }, 'getComments failed')
    throw classifyKaneoError(error)
  }
}
