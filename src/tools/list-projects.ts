// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-projects' })

export function makeListProjectsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all available projects. Call this to get project IDs before creating or searching tasks.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const projects = await provider.listProjects!()
        log.info({ count: projects.length }, 'Projects listed via tool')
        return projects
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_projects' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
