// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:remove-label' })

export function makeRemoveLabelTool(provider: TaskProvider): Tool {
  return tool({
    description: 'Remove (delete) a label.',
    inputSchema: z.object({
      labelId: z.string().describe('Label ID to remove'),
      label: z.string().optional().describe('Human-readable label name for the confirmation message (e.g. "urgent")'),
      confidence: confidenceField,
    }),
    execute: async ({ labelId, label, confidence }) => {
      log.debug({ confidence }, 'remove_label called')
      const gate = checkConfidence(confidence, `Remove label "${label ?? labelId}"`)
      if (gate !== null) {
        log.warn({ confidence }, 'remove_label blocked — confirmation required')
        return gate
      }
      try {
        return await provider.removeLabel!(labelId)
      } catch (error) {
        log.error(toolFailureMeta('remove_label', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
