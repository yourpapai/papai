// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:remove-attachment' })

export function makeRemoveAttachmentTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      'Remove an attachment from a task permanently. This is a destructive action that requires confirmation.',
    inputSchema: z.object({
      taskId: z.string().describe('Task ID the attachment belongs to'),
      attachmentId: z.string().describe('Attachment ID to remove'),
      label: z
        .string()
        .optional()
        .describe('Human-readable attachment filename for the confirmation message (e.g. "screenshot.png")'),
      confidence: confidenceField,
    }),
    execute: async ({ taskId, attachmentId, label, confidence }) => {
      log.debug({ taskId, attachmentId, confidence }, 'remove_attachment called')
      const gate = checkConfidence(confidence, `Remove attachment "${label ?? attachmentId}"`)
      if (gate !== null) {
        log.warn({ taskId, attachmentId, confidence }, 'remove_attachment blocked — confirmation required')
        return gate
      }
      try {
        const result = await provider.deleteAttachment!(taskId, attachmentId)
        log.info({ taskId, attachmentId }, 'Attachment removed')
        return result
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            attachmentId,
            tool: 'remove_attachment',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
