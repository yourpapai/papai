// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:remove-comment' })

export async function removeComment({
  config,
  activityId,
}: {
  config: KaneoConfig
  activityId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ commentId: activityId }, 'removeComment called')

  try {
    const client = new KaneoClient(config)
    const result = await client.comments.remove(activityId)
    log.info({ commentId: activityId }, 'Comment removed')
    return result
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), commentId: activityId },
      'removeComment failed',
    )
    throw classifyKaneoError(error)
  }
}
