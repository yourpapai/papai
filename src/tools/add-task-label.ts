// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:add-task-label' })

const labelTargetSchema = z
  .object({
    taskId: z.string().describe('Task ID'),
    labelId: z.string().optional().describe('Label ID to add'),
    labelName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Visible label name to add when you do not already know the label ID'),
  })
  .refine((value) => (value.labelId === undefined) !== (value.labelName === undefined), {
    message: 'Provide exactly one of labelId or labelName',
    path: ['labelId'],
  })

const resolveLabelId = async (
  provider: Readonly<TaskProvider>,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string> => {
  if (labelId !== undefined) return labelId
  if (labelName === undefined) {
    throw new Error('Provide exactly one of labelId or labelName')
  }
  const labels =
    provider.getLabelByName === undefined ? await provider.listLabels?.() : await provider.getLabelByName(labelName)
  const matches = (labels ?? []).filter((label) => label.name === labelName)
  if (matches.length === 0) {
    throw new Error(`Label not found: ${labelName}`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple labels found: ${labelName}`)
  }
  const [match] = matches
  if (match === undefined) {
    throw new Error(`Label not found: ${labelName}`)
  }
  return match.id
}

export function makeAddTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Add a label to a task. Prefer labelName for natural-language tagging flows, or use labelId when you already have an exact ID from list_labels.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        const resolvedLabelId = await resolveLabelId(provider, labelId, labelName)
        return await provider.addTaskLabel!(taskId, resolvedLabelId)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            labelId,
            labelName,
            tool: 'add_task_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
