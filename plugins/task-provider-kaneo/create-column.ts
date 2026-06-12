// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../src/logger.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { ColumnCompatSchema } from './schemas/api-compat.js'

const log = logger.child({ scope: 'kaneo:create-column' })

type CreateColumnResponse = z.infer<typeof ColumnCompatSchema>

export async function createColumn({
  config,
  projectId,
  name,
  icon,
  color,
  isFinal,
}: {
  config: KaneoConfig
  projectId: string
  name: string
  icon?: string
  color?: string
  isFinal?: boolean
}): Promise<CreateColumnResponse> {
  log.debug(
    { projectId, name, hasIcon: icon !== undefined, hasColor: color !== undefined, isFinal },
    'createColumn called',
  )

  try {
    const client = new KaneoClient(config)
    const column = await client.columns.create(projectId, { name, icon, color, isFinal })
    log.info({ columnId: column.id, name: column.name, projectId }, 'Column created')
    return column
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId, name }, 'createColumn failed')
    throw error
  }
}
