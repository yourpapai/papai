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

const log = logger.child({ scope: 'tool:get-project' })

export function makeGetProjectTool(provider: Readonly<TaskProvider>): Tool {
  return tool({
    description: 'Fetch complete details of a single project by ID.',
    inputSchema: z.object({ projectId: z.string().describe('Project ID') }),
    execute: async ({ projectId }) => {
      try {
        const project = await provider.getProject!(projectId)
        log.info('Project fetched via tool')
        return project
      } catch (error) {
        log.error(toolFailureMeta('get_project', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
