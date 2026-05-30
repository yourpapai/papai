// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../../src/logger.js'
import { classifyKaneoError } from './classify-error.js'
import type { KaneoConfig } from './client.js'
import { KaneoClient } from './kaneo-client.js'

const log = logger.child({ scope: 'kaneo:remove-label' })

export async function removeLabel({
  config,
  labelId,
}: {
  config: KaneoConfig
  labelId: string
}): Promise<{ id: string; success: true }> {
  log.debug({ labelId }, 'removeLabel called')

  try {
    const client = new KaneoClient(config)
    const result = await client.labels.remove(labelId)
    log.info({ labelId }, 'Label removed')
    return result
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error), labelId }, 'removeLabel failed')
    throw classifyKaneoError(error)
  }
}
