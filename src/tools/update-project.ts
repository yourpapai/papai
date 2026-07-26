// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { toolFailureMeta } from './tool-logging.js'

const log = logger.child({ scope: 'tool:update-project' })

export function makeUpdateProjectTool(provider: TaskProvider): Tool {
  return tool({
    description: 'Update an existing project.',
    inputSchema: z
      .object({
        projectId: z.string().describe('Project ID'),
        name: z.string().optional().describe('New project name'),
        description: z.string().optional().describe('New project description'),
      })
      .refine(
        (data) => data.name !== undefined || data.description !== undefined,
        'At least one of name or description must be provided',
      ),
    execute: async ({ projectId, name, description }) => {
      try {
        const project = await provider.updateProject!(projectId, { name, description })
        log.info('Project updated via tool')
        return project
      } catch (error) {
        log.error(toolFailureMeta('update_project', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
