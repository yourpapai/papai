// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

const log = logger.child({ scope: 'kaneo:list-labels' })

type KaneoLabel = z.infer<typeof CreateLabelResponseSchema>

export async function listLabels({
  config,
  workspaceId,
}: {
  config: KaneoConfig
  workspaceId: string
}): Promise<KaneoLabel[]> {
  log.debug({ workspaceId }, 'listLabels called')

  try {
    const client = new KaneoClient(config)
    const labels = await client.labels.list(workspaceId)
    log.info({ workspaceId, labelCount: labels.length }, 'Labels listed')
    return labels
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), workspaceId }, 'listLabels failed')
    throw classifyKaneoError(error)
  }
}
