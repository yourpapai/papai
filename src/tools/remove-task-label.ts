// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import type { TaskLabel, TaskProvider } from '../providers/types.js'
import { listTaskLabels, listVisibleWorkspaceLabels, usesSeparateLabelReadApi } from './kaneo-label-helpers.js'

const log = logger.child({ scope: 'tool:remove-task-label' })

const labelTargetSchema = z
  .object({
    taskId: z.string().describe('Task ID'),
    labelId: z.string().optional().describe('Label ID to remove'),
    labelName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe('Visible label name to remove when you do not already know the label ID'),
  })
  .refine((value) => (value.labelId === undefined) !== (value.labelName === undefined), {
    message: 'Provide exactly one of labelId or labelName',
    path: ['labelId'],
  })

type AlreadyAbsentByNameResult = {
  status: 'already_absent'
  taskId: string
  labelName: string
  message: string
}

type AlreadyAbsentByIdResult = {
  status: 'already_absent'
  taskId: string
  labelId: string
  message: string
}

type AlreadyAbsentResult = AlreadyAbsentByNameResult | AlreadyAbsentByIdResult

const alreadyAbsentByName = (taskId: string, labelName: string, message: string): AlreadyAbsentByNameResult => ({
  status: 'already_absent',
  taskId,
  labelName,
  message,
})

const alreadyAbsentById = (taskId: string, labelId: string, message: string): AlreadyAbsentByIdResult => ({
  status: 'already_absent',
  taskId,
  labelId,
  message,
})

const missingTaskLabelById = (taskId: string, labelId: string): AlreadyAbsentByIdResult =>
  alreadyAbsentById(taskId, labelId, `Task does not currently have label id "${labelId}". No action was taken.`)

const resolveKaneoTaskLabelIdById = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string,
  taskLabels: readonly TaskLabel[],
): Promise<string | AlreadyAbsentByIdResult> => {
  const direct = taskLabels.find((label) => label.id === labelId)
  if (direct !== undefined) return direct.id

  const workspaceLabels = await listVisibleWorkspaceLabels(provider, labelId)
  const workspaceLabel = workspaceLabels.find((label) => label.id === labelId)
  if (workspaceLabel === undefined) {
    return missingTaskLabelById(taskId, labelId)
  }

  const taskMatches = taskLabels.filter((label) => label.name === workspaceLabel.name)
  if (taskMatches.length === 0) {
    return missingTaskLabelById(taskId, labelId)
  }
  if (taskMatches.length > 1) {
    throw new Error(`Multiple task labels found: ${workspaceLabel.name}`)
  }
  return taskMatches[0]!.id
}

const resolveKaneoTaskLabelId = async (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string | AlreadyAbsentResult> => {
  const taskLabels = await listTaskLabels(provider, taskId)

  if (labelId !== undefined) {
    return resolveKaneoTaskLabelIdById(provider, taskId, labelId, taskLabels)
  }

  if (labelName === undefined) {
    throw new Error('Provide exactly one of labelId or labelName')
  }

  const matches = taskLabels.filter((label) => label.name === labelName)
  if (matches.length === 0) {
    return alreadyAbsentByName(
      taskId,
      labelName,
      `Task does not currently have label "${labelName}". No action was taken.`,
    )
  }
  if (matches.length > 1) {
    throw new Error(`Multiple task labels found: ${labelName}`)
  }
  return matches[0]!.id
}

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

const resolveTaskLabelId = (
  provider: Readonly<TaskProvider>,
  taskId: string,
  labelId: string | undefined,
  labelName: string | undefined,
): Promise<string | AlreadyAbsentResult> => {
  if (usesSeparateLabelReadApi(provider)) {
    return resolveKaneoTaskLabelId(provider, taskId, labelId, labelName)
  }

  return resolveWorkspaceLabelId(provider, labelId, labelName)
}

export function makeRemoveTaskLabelTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Remove a label from a task. For Kaneo, labelName resolves against labels currently attached to the task and returns already_absent when the task does not have that label.',
    inputSchema: labelTargetSchema,
    execute: async ({ taskId, labelId, labelName }) => {
      try {
        const resolved = await resolveTaskLabelId(provider, taskId, labelId, labelName)
        if (typeof resolved === 'object' && 'status' in resolved) return resolved
        return await provider.removeTaskLabel!(taskId, resolved)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            taskId,
            labelId,
            labelName,
            tool: 'remove_task_label',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
