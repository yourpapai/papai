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

const log = logger.child({ scope: 'tool:list-labels' })

export function makeListLabelsTool(provider: TaskProvider): Tool {
  return tool({
    description: 'List all available labels in the workspace. Use this to get label IDs before applying labels.',
    inputSchema: z.object({}),
    execute: async () => {
      try {
        return await provider.listLabels!()
      } catch (error) {
        log.error(toolFailureMeta('list_labels', error), 'Tool execution failed')
        throw error
      }
    },
  })
}
