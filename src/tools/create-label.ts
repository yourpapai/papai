// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { listVisibleWorkspaceLabels, usesSeparateLabelReadApi } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:create-label' })

export function makeCreateLabelTool(provider: TaskProvider): ToolSet[string] {
  return tool({
    description:
      'Create a new label in the workspace. In Kaneo, this creates a reusable workspace label and returns already_exists instead of creating a duplicate reusable label.',
    inputSchema: z.object({
      name: z.string().describe('Label name'),
      color: z.string().optional().describe("Hex color code (e.g. '#ff0000')"),
    }),
    execute: async ({ name, color }) => {
      try {
        if (usesSeparateLabelReadApi(provider)) {
          const existing = (await listVisibleWorkspaceLabels(provider, name)).filter((label) => label.name === name)
          if (existing.length > 0) {
            return {
              status: 'already_exists' as const,
              labelName: name,
              existingLabelIds: existing.map((label) => label.id),
              message: `Reusable workspace label "${name}" already exists. No new label was created.`,
            }
          }
        }

        return await provider.createLabel!({ name, color })
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            name,
            tool: 'create_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
