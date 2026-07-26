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

const log = logger.child({ scope: 'tool:list-project-team' })

export function makeListProjectTeamTool(provider: TaskProvider): Tool {
  return tool({
    description: 'List the team assigned to a project so you can inspect current project membership.',
    inputSchema: z.object({
      projectId: z.string().describe('Project ID whose team members should be listed'),
    }),
    execute: async ({ projectId }) => {
      try {
        const users = await provider.listProjectTeam!(projectId)
        log.info({ count: users.length }, 'Project team listed via tool')
        return users
      } catch (error) {
        log.error(toolFailureMeta('list_project_team', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
