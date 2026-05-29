// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { ColumnCompatSchema } from './schemas/api-compat.js'

const log = logger.child({ scope: 'kaneo:list-columns' })

type KaneoColumn = z.infer<typeof ColumnCompatSchema>

export async function listColumns({
  config,
  projectId,
}: {
  config: KaneoConfig
  projectId: string
}): Promise<KaneoColumn[]> {
  log.debug({ projectId }, 'listColumns called')

  try {
    const client = new KaneoClient(config)
    const columns = await client.columns.list(projectId)
    log.info({ projectId, columnCount: columns.length }, 'Columns listed')
    return columns
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), projectId }, 'listColumns failed')
    throw classifyKaneoError(error)
  }
}
