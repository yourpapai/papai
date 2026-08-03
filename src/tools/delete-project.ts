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

const log = logger.child({ scope: 'tool:delete-project' })

export function makeDeleteProjectTool(provider: TaskProvider): Tool {
  return tool({
    description: 'Delete a project permanently. This is a destructive action that requires confirmation.',
    inputSchema: z.object({
      projectId: z.string().describe('The project ID to delete'),
      label: z
        .string()
        .optional()
        .describe('Human-readable project name for the confirmation message (e.g. "My Project")'),
      confidence: confidenceField,
    }),
    execute: async ({ projectId, label, confidence }) => {
      log.debug({ confidence }, 'delete_project called')
      const gate = checkConfidence(confidence, `Delete "${label ?? projectId}"`)
      if (gate !== null) {
        log.warn({ confidence }, 'delete_project blocked — confirmation required')
        return gate
      }
      try {
        const result = await provider.deleteProject!(projectId)
        log.info('Project deleted')
        return result
      } catch (error) {
        log.error(toolFailureMeta('delete_project', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
