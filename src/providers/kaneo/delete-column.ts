// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:delete-column' })

export async function deleteColumn({
  config,
  columnId,
}: {
  config: KaneoConfig
  columnId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ columnId }, 'deleteColumn called')

  try {
    const client = new KaneoClient(config)
    const result = await client.columns.remove(columnId)
    log.info({ columnId }, 'Column deleted')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), columnId }, 'deleteColumn failed')
    throw error
  }
}
