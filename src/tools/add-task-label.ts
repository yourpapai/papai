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

type AlreadyPresentResult = {
  status: 'already_present'
  taskId: string
  labelName: string
  taskLabelIds: string[]
  message: string
}

const alreadyPresent = (taskId: string, labelName: string, taskLabelIds: string[]): AlreadyPresentResult => ({
  status: 'already_present',
  taskId,
  labelName,
  taskLabelIds,
  message: `Task already has label "${labelName}". No action was taken.`,
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

const resolveKaneoAlreadyPresent = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<AlreadyPresentResult | null> => {
  const taskMatches = await listTaskLabels(provider, taskId)

  if (labelName !== undefined) {
    const matchingByName = taskMatches.filter((label) => label.name === labelName)
    if (matchingByName.length > 0) {
      return alreadyPresent(taskId, labelName, matchingByName.map((label) => label.id))
    }
    return null
  }

  if (labelId === undefined) return null

  const directMatch = taskMatches.find((label) => label.id === labelId)
  if (directMatch !== undefined) {
    return alreadyPresent(taskId, directMatch.name, [directMatch.id])
  }

  const workspaceLabel = (await listVisibleWorkspaceLabels(provider, undefined)).find((label) => label.id === labelId)
  if (workspaceLabel === undefined) return null

  const matchingByName = taskMatches.filter((label) => label.name === workspaceLabel.name)
  if (matchingByName.length === 0) return null

  return alreadyPresent(taskId, workspaceLabel.name, matchingByName.map((label) => label.id))
}

export function makeAddTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Add a label to a task. For Kaneo, labelName resolves against reusable workspace labels and returns already_present when the task already has that visible label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        if (isKaneoProvider(provider)) {
          const existing = await resolveKaneoAlreadyPresent(provider, taskId, labelId, labelName)
          if (existing !== null) return existing
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
