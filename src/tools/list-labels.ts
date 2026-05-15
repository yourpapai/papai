// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:list-labels' })

export function makeListLabelsTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description: 'List all available labels in the workspace. Use this to get label IDs before applying labels.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await provider.listLabels!()
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'list_labels' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
