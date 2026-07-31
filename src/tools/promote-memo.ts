// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { Tool } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { getMemo, addMemoLink, archiveMemos } from '../memos.js'
import type { TaskProvider } from '../providers/types.js'
import { toolErrorClass } from './tool-logging.js'

const log = logger.child({ scope: 'tool:memo' })

export function makePromoteMemoTool(provider: Readonly<TaskProvider>, userId: string): Tool {
  return tool({
    description: 'Promote a personal note to a tracked task. Call list_memos or search_memos first to get the memo_id.',
    inputSchema: z.object({
      memoId: z.string().describe('The memo ID to promote'),
      projectId: z.string().describe('Project ID — call list_projects first'),
      title: z.string().optional().describe('Task title — defaults to memo content (truncated)'),
      dueDate: z
        .object({
          date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
          time: z.string().optional().describe('Time in HH:MM 24-hour format (ignored for YouTrack due dates)'),
        })
        .optional()
        .describe(
          "Due date input. For most providers, date+time is converted from the user's local time to UTC. For YouTrack, due dates are date-only and time-of-day is ignored.",
        ),
    }),
    execute: ({ memoId, projectId, title, dueDate }) => {
      log.debug('promote_memo called')
      return promoteToTask(provider, userId, memoId, projectId, title, dueDate)
    },
  })
}

async function promoteToTask(
  provider: Readonly<TaskProvider>,
  userId: string,
  memoId: string,
  projectId: string,
  title?: string,
  dueDate?: { date: string; time?: string },
): Promise<Record<string, unknown>> {
  const memo = getMemo(userId, memoId)
  if (memo === null) {
    log.warn('Memo not found for promotion')
    return { status: 'error', message: `Memo "${memoId}" not found.` }
  }

  const taskTitle = title ?? memo.content.slice(0, 100)
  const timezone = getConfig(userId, 'timezone') ?? 'UTC'
  const resolvedDueDate = provider.normalizeDueDateInput(dueDate, timezone)

  let task: Awaited<ReturnType<typeof provider.createTask>>
  try {
    task = await provider.createTask({
      projectId,
      title: taskTitle,
      description: memo.content,
      dueDate: resolvedDueDate,
    })
  } catch (error) {
    log.error({ errorClass: toolErrorClass(error) }, 'Failed to create task from memo')
    return {
      status: 'error',
      message: `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  addMemoLink(memoId, task.id, 'action_for')
  archiveMemos(userId, { memoIds: [memoId] })
  log.info('Memo promoted to task')

  return {
    status: 'promoted',
    taskId: task.id,
    taskTitle: task.title,
    taskUrl: task.url,
    memoId,
    dueDate: provider.formatDueDateOutput(task.dueDate, timezone),
  }
}
