// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { getConfig } from '../config.js'
import { resolveMeReference } from '../identity/resolver.js'
import { logger } from '../logger.js'
import { providerError, ProviderClassifiedError } from '../providers/errors.js'
import type { TaskProvider } from '../providers/types.js'

const log = logger.child({ scope: 'tool:create-task' })

const assertCustomFieldsSupported = (
  provider: Readonly<TaskProvider>,
  customFields: ReadonlyArray<{ name: string; value: string }> | undefined,
): void => {
  if (customFields === undefined || customFields.length === 0 || provider.supportsCustomFields === true) {
    return
  }

  throw new ProviderClassifiedError(
    'customFields are only supported for create_task with YouTrack',
    providerError.validationFailed(
      'customFields',
      `Provider ${provider.name} does not support customFields in create_task`,
    ),
  )
}

interface ResolveAssigneeResult {
  assignee?: string
  identityRequired?: { status: 'identity_required'; message: string }
}

async function resolveAssignee(
  assignee: string | undefined,
  userId: string | undefined,
  provider: TaskProvider,
): Promise<ResolveAssigneeResult> {
  if (assignee === undefined || assignee.toLowerCase() !== 'me' || userId === undefined) {
    return { assignee }
  }

  const identity = await resolveMeReference(userId, provider)
  if (identity.type === 'found') {
    const identifier = provider.preferredUserIdentifier === 'login' ? identity.identity.login : identity.identity.userId
    return { assignee: identifier }
  }
  return { identityRequired: { status: 'identity_required', message: identity.message } }
}

async function executeCreateTask(
  params: {
    title: string
    description?: string
    priority?: string
    projectId: string
    dueDate?: { date: string; time?: string }
    status?: string
    assignee?: string
    customFields?: Array<{ name: string; value: string }>
  },
  userId: string | undefined,
  storageContextId: string | undefined,
  provider: TaskProvider,
): Promise<unknown> {
  const { title, description, priority, projectId, dueDate, status, assignee, customFields } = params
  const configKey = storageContextId ?? userId
  const timezone = configKey === undefined ? 'UTC' : (getConfig(configKey, 'timezone') ?? 'UTC')
  const resolvedDueDate = provider.normalizeDueDateInput(dueDate, timezone)
  const { assignee: resolvedAssignee, identityRequired } = await resolveAssignee(assignee, userId, provider)
  if (identityRequired !== undefined) return identityRequired
  assertCustomFieldsSupported(provider, customFields)
  const task = await provider.createTask({
    projectId,
    title,
    description,
    priority,
    status,
    dueDate: resolvedDueDate,
    assignee: resolvedAssignee,
    customFields,
  })
  log.info(
    {
      taskId: task.id,
      title,
      hasCustomFields: customFields !== undefined && customFields.length > 0,
    },
    'Task created via tool',
  )
  return { ...task, dueDate: provider.formatDueDateOutput(task.dueDate, timezone) }
}

const createTaskInputSchema = z.object({
  title: z.string().describe('Short, descriptive task title'),
  description: z.string().optional().describe('Detailed description of the task'),
  priority: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Priority value. Must match the upstream provider's configured priority values."),
  projectId: z.string().describe('Project ID — call list_projects first to obtain this'),
  dueDate: z
    .object({
      date: z.string().describe("Date in YYYY-MM-DD format (user's local date)"),
      time: z.string().optional().describe('Time in HH:MM 24-hour format (ignored for YouTrack due dates)'),
    })
    .optional()
    .describe(
      "Due date input. For most providers, date+time is converted from the user's local time to UTC. For YouTrack, due dates are date-only and time-of-day is ignored.",
    ),
  status: z
    .string()
    .optional()
    .describe(
      "Status/State value. For YouTrack this must exactly match one of the project's State values — call describe_project to get them (they may be localized). For other providers, a status column slug (e.g. 'to-do', 'in-progress', 'done').",
    ),
  assignee: z.string().optional().describe("User ID to assign the task to, or 'me' to assign to yourself"),
  customFields: z
    .array(z.object({ name: z.string(), value: z.string() }))
    .optional()
    .describe(
      'For YouTrack, set required project custom fields by name (any field type — enum, state, version, etc.). Call describe_project to discover field names and allowed values, and use those exact values. Prefer the dedicated status/priority/assignee/dueDate parameters where they apply.',
    ),
})

export function makeCreateTaskTool(
  provider: TaskProvider,
  userId?: string,
  storageContextId?: string,
): ToolSet[string] {
  return tool({
    description:
      'Create a new task. Call list_projects first to get a valid projectId. For YouTrack, if the project has required custom fields call describe_project first to learn the field names and valid values (e.g. State names, which may be localized).',
    inputSchema: createTaskInputSchema,
    execute: async (params) => {
      try {
        return await executeCreateTask(params, userId, storageContextId, provider)
      } catch (error) {
        log.error(
          {
            error: error instanceof Error ? error.message : String(error),
            title: params.title,
            tool: 'create_task',
          },
          'Tool execution failed',
        )
        throw error
      }
    },
  })
}
