// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-project' })

export function makeCreateProjectTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'Create a new project in the task tracker.',
    inputSchema: z.object({
      name: z.string().describe('Project name'),
      description: z.string().optional().describe('Project description'),
    }),
    execute: async ({ name, description }) => {
      try {
        const project = await provider.createProject!({ name, description })
        log.info({ projectId: project.id, name }, 'Project created via tool')
        return project
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            name,
            tool: 'create_project',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
