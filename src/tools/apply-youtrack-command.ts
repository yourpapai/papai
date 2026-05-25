// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { logger } from '../logger.js'
import { providerError, ProviderClassifiedError } from '../providers/errors.js'
import type { TaskCommandResult, TaskProvider } from '../providers/types.js'
import { checkConfidence, confidenceField } from './confirmation-gate.js'

const log = logger.child({ scope: 'tool:apply-youtrack-command' })

const NON_EMPTY_STRING = z.string().trim().min(1)

const normalizeCommand = (query: string): string => query.trim().replace(/\s+/gu, ' ').toLowerCase()

// YouTrack commands are space-delimited and tag values may contain spaces, so only
// exact commands or the single-token assignee form can bypass confirmation safely.
const SAFE_COMMANDS = new Set<string>(['for me', 'vote', 'unvote', 'star', 'unstar'])

const SINGLE_ASSIGNEE_COMMAND = /^for\s+\S+$/iu

const requiresConfirmation = (query: string, comment: string | undefined, silent: boolean | undefined): boolean => {
  if (comment !== undefined || silent === true) return true
  const normalizedQuery = normalizeCommand(query)
  return !SAFE_COMMANDS.has(normalizedQuery) && !SINGLE_ASSIGNEE_COMMAND.test(normalizedQuery)
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
  ].filter((detail): detail is string => detail !== null)
  const suffix = details.length > 0 ? ` (${details.join(', ')})` : ''
  return `Apply YouTrack command "${query.trim()}" to ${taskCount} issue(s)${suffix}`
}

const BULK_COMMAND_DISABLED_REASON =
  'Bulk YouTrack commands are disabled for safety. Use structured tools when possible, or run the command one issue at a time. In other words, bulk commands are disabled for safety.'

const TASK_IDS_SCHEMA = z
  .array(NON_EMPTY_STRING)
  .min(1)
  .describe(
    'Provide issue IDs as an array, for example ["TEST-1"]. Multi-issue requests are rejected for safety, so this tool is intended for single-issue use.',
  )

const rejectBulkCommand = (query: string, taskCount: number): never => {
  log.warn({ query, taskCount }, 'apply_youtrack_command blocked — bulk commands disabled')
  throw new ProviderClassifiedError(
    BULK_COMMAND_DISABLED_REASON,
    providerError.validationFailed('taskIds', BULK_COMMAND_DISABLED_REASON),
  )
}

const applyYouTrackCommandInputSchema = z.object({
  query: NON_EMPTY_STRING.describe('The YouTrack command string to apply, for example "for me" or "State In Progress"'),
  taskIds: TASK_IDS_SCHEMA,
  comment: z.string().optional().describe('Optional comment to add while applying the command'),
  silent: z.boolean().optional().describe('Whether to suppress notifications for this command when supported'),
  confidence: confidenceField.optional(),
})

async function executeApplyYouTrackCommand(
  provider: Readonly<TaskProvider>,
  { query, taskIds, comment, silent, confidence }: z.infer<typeof applyYouTrackCommandInputSchema>,
): Promise<unknown> {
  const applyCommand = provider.applyCommand
  if (applyCommand === undefined) {
    throw new Error('YouTrack command support is unavailable')
  }

  if (taskIds.length > 1) {
    rejectBulkCommand(query, taskIds.length)
  }

  if (requiresConfirmation(query, comment, silent)) {
    const gate = checkConfidence(confidence ?? 0, describeAction(query, taskIds.length, comment, silent))
    if (gate !== null) {
      log.warn(
        { query, taskCount: taskIds.length, confidence },
        'apply_youtrack_command blocked — confirmation required',
      )
      return gate
    }
  }

  try {
    const result: TaskCommandResult = await applyCommand({ query, taskIds, comment, silent })
    log.info({ query, taskCount: taskIds.length }, 'YouTrack command applied via tool')
    return result
  } catch (error) {
    log.error(
      {
        error: error instanceof Error ? error.message : String(error),
        query,
        tool: 'apply_youtrack_command',
      },
      'Tool execution failed',
    )
    throw error
  }
}

export function makeApplyYouTrackCommandTool(provider: Readonly<TaskProvider>): ToolSet[string] {
  return tool({
    description:
      'Apply a YouTrack command to a single YouTrack issue. Use this only for YouTrack-native command workflows that do not fit the structured tools.',
    inputSchema: applyYouTrackCommandInputSchema,
    execute: (params) => executeApplyYouTrackCommand(provider, params),
  })
}
