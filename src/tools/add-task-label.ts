// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { isKaneoProvider, listTaskLabels, listVisibleWorkspaceLabels } from './kaneo-label-helpers.js'

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

const resolveWorkspaceLabelId = async (
  provider: Readonly<TaskProvider>,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string> => {
  if (labelId !== undefined) return labelId
  if (labelName === undefined) {
    throw new Error('Provide exactly one of labelId or labelName')
  }
  const labels = await listVisibleWorkspaceLabels(provider, labelName)
  const matches = labels.filter((label) => label.name === labelName)
  if (matches.length === 0) {
    throw new Error(`Label not found: ${labelName}`)
  }
  if (matches.length > 1) {
    throw new Error(`Multiple labels found: ${labelName}`)
  }
  return matches[0]!.id
}

export function makeAddTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Add a label to a task. For Kaneo, labelName resolves against reusable workspace labels and returns already_present when the task already has that visible label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        if (isKaneoProvider(provider) && labelName !== undefined) {
          const taskMatches = (await listTaskLabels(provider, taskId)).filter((label) => label.name === labelName)
          if (taskMatches.length > 0) {
            return {
              status: 'already_present' as const,
              taskId,
              labelName,
              taskLabelIds: taskMatches.map((label) => label.id),
              message: `Task already has label "${labelName}". No action was taken.`,
            }
          }
        }

        const resolvedLabelId = await resolveWorkspaceLabelId(provider, labelId, labelName)
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
