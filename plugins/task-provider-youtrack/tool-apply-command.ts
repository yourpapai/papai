// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

const CONFIDENCE_THRESHOLD = 0.85
const NON_EMPTY_STRING = z.string().trim().min(1)
const SAFE_COMMANDS = new Set<string>(['for me', 'vote', 'unvote', 'star', 'unstar'])
const SINGLE_ASSIGNEE_COMMAND = /^for\s+\S+$/iu
const BULK_COMMAND_DISABLED_REASON =
  'Bulk YouTrack commands are disabled for safety. Use structured tools when possible, or run the command one issue at a time. In other words, bulk commands are disabled for safety.'

const normalizeCommand = (query: string): string => query.trim().replace(/\s+/gu, ' ').toLowerCase()
const requiresConfirmation = (query: string, comment: string | undefined, silent: boolean | undefined): boolean => {
  if (comment !== undefined || silent === true) return true
  const n = normalizeCommand(query)
  return !SAFE_COMMANDS.has(n) && !SINGLE_ASSIGNEE_COMMAND.test(n)
}
const describeAction = (
  query: string,
  taskCount: number,
  comment: string | undefined,
  silent: boolean | undefined,
): string => {
  const details = [
    comment === undefined ? null : 'with a comment',
    silent === true ? 'without notifications' : null,
  ].filter((d): d is string => d !== null)
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `Apply YouTrack command "${query.trim()}" to ${taskCount} issue(s)${suffix}`
}

export const applyYouTrackCommandInputSchema = z.object({
  query: NON_EMPTY_STRING.describe('The YouTrack command string to apply, for example "for me" or "State In Progress"'),
  taskIds: z
    .array(NON_EMPTY_STRING)
    .min(1)
    .describe(
      'Provide issue IDs as an array, for example ["TEST-1"]. Multi-issue requests are rejected for safety, so this tool is intended for single-issue use.',
    ),
  comment: z.string().optional().describe('Optional comment to add while applying the command'),
  silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .optional()
    .describe(
      'Your confidence (0–1) that the user explicitly wants this action. Set 1.0 when already confirmed, 0.9 for a direct command, ≤0.7 when indirect. Blocked and confirmation requested if below 0.85.',
    ),
})

// Structural type for the host-provided runtime context (plugins cannot import src/).
export type RuntimeContextLike = {
  taskProvider?: {
    applyCommand?(params: { query: string; taskIds: string[]; comment?: string; silent?: boolean }): Promise<unknown>
  }
}

export function executeApplyYouTrackCommand(input: unknown, runtimeContext: RuntimeContextLike): Promise<unknown> {
  const parsed = applyYouTrackCommandInputSchema.safeParse(input)
  if (!parsed.success) {
    return Promise.resolve({ status: 'failed', error: 'invalid input for apply_youtrack_command' })
  }
  const { query, taskIds, comment, silent, confidence } = parsed.data
  if (taskIds.length > 1) return Promise.resolve({ status: 'failed', error: BULK_COMMAND_DISABLED_REASON })
  if (requiresConfirmation(query, comment, silent) && (confidence ?? 0) < CONFIDENCE_THRESHOLD) {
    return Promise.resolve({
      status: 'confirmation_required',
      message: `${describeAction(query, taskIds.length, comment, silent)}? This action is irreversible — please confirm.`,
    })
  }
  const taskProvider = runtimeContext.taskProvider
  if (taskProvider?.applyCommand === undefined) {
    return Promise.resolve({ status: 'failed', error: 'YouTrack command support is unavailable' })
  }
  return taskProvider.applyCommand({ query, taskIds, comment, silent })
}
