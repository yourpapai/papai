// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../logger.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:reorder-columns' })

export async function reorderColumns({
  config,
  projectId,
  columns,
}: {
  config: KaneoConfig
  projectId: string
  columns: { id: string; position: number }[]
}): Promise<{ success: true }> {
  log.debug({ projectId, columnCount: columns.length }, 'reorderColumns called')

  try {
    const client = new KaneoClient(config)
    const result = await client.columns.reorder(projectId, columns)
    log.info({ projectId, columnCount: columns.length }, 'Columns reordered')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'reorderColumns failed')
    throw error
  }
}
