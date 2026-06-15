// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:describe-project' })

export function makeDescribeProjectTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      "Inspect a project's custom fields BEFORE creating or updating a task. Returns each field's name, type, whether it is required, its default, and allowed values (e.g. the valid State names, which may be localized). Call this proactively before creating a task in an unfamiliar project, or whenever create_task fails with a required/unknown-field error. Use the exact allowedValues when setting status, priority, or custom fields.",
    inputSchema: z.object({
      projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
    }),
    execute: async ({ projectId }) => {
      try {
        const fields = (await provider.describeProjectFields?.(projectId)) ?? []
        log.info({ projectId, count: fields.length }, 'Described project fields')
        return { projectId, fields }
      } catch (error) {
        log.error(
          { error: error instanceof Error ? error.message : String(error), tool: 'describe_project' },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
