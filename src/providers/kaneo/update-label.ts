// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { providerError } from '../../errors.js'
import { logger } from '../../logger.js'
import { classifyKaneoError, KaneoClassifiedError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'
import type { CreateLabelResponse } from './schemas/create-label.js'

const log = logger.child({ scope: 'kaneo:update-label' })

type KaneoLabel = CreateLabelResponse

export async function updateLabel({
  config,
  labelId,
  name,
  color,
}: {
  config: KaneoConfig
  labelId: string
  name?: string
  color?: string
}): Promise<KaneoLabel> {
  log.debug({ labelId, hasName: name !== undefined, hasColor: color !== undefined }, 'updateLabel called')

  if (name === undefined && color === undefined) {
    throw new KaneoClassifiedError(
      'At least one field (name or color) must be provided to update a label',
      providerError.validationFailed('fields', 'No update fields provided'),
    )
  }

  try {
    const client = new KaneoClient(config)
    const label = await client.labels.update(labelId, { name, color })
    log.info({ labelId, name: label.name }, 'Label updated')
    return label
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'updateLabel failed')
    throw classifyKaneoError(error)
  }
}
