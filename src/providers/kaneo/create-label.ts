// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { logger } from '../../logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import { CreateLabelResponseSchema } from './schemas/create-label.js'

const log = logger.child({ scope: 'kaneo:create-label' })

type CreateLabelResponse = z.infer<typeof CreateLabelResponseSchema>
type KaneoLabel = CreateLabelResponse

export async function createLabel({
  config,
  workspaceId,
  name,
  color,
}: {
  config: KaneoConfig
  workspaceId: string
  name: string
  color?: string
}): Promise<KaneoLabel> {
  log.debug({ workspaceId, name, hasColor: color !== undefined }, 'createLabel called')

  try {
    const client = new KaneoClient(config)
    const label = await client.labels.create({ workspaceId, name, color })
    log.info({ workspaceId, labelId: label.id, name }, 'Label created')
    return label
  } catch (error) {
    log.error(
      { error: error instanceof Error ? error.message : String(error), workspaceId, name },
      'createLabel failed',
    )
    throw classifyKaneoError(error)
  }
}
