// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { ColumnCompatSchema } from './schemas/api-compat.js'

const log = logger.child({ scope: 'kaneo:update-column' })

type UpdateColumnResponse = z.infer<typeof ColumnCompatSchema>

export async function updateColumn({
  config,
  columnId,
  name,
  icon,
  color,
  isFinal,
}: {
  config: KaneoConfig
  columnId: string
  name?: string
  icon?: string
  color?: string
  isFinal?: boolean
}): Promise<UpdateColumnResponse> {
  log.debug(
    { columnId, hasName: name !== undefined, hasIcon: icon !== undefined, hasColor: color !== undefined, isFinal },
    'updateColumn called',
  )

  try {
    const client = new KaneoClient(config)
    const column = await client.columns.update(columnId, { name, icon, color, isFinal })
    log.info({ columnId, name: column.name }, 'Column updated')
    return column
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), columnId }, 'updateColumn failed')
    throw classifyKaneoError(error)
  }
}
