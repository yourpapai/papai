// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import {
  findTemplateByTaskId as defaultFindTemplateByTaskId,
  isCompletionStatus as defaultIsCompletionStatus,
  recordOccurrence as defaultRecordOccurrence,
} from '../recurring-occurrences.js'
import type { RecurringTaskRecord } from '../recurring.js'
import { markExecuted as defaultMarkExecuted } from '../recurring.js'

const log = logger.child({ scope: 'completion-hook' })

export type CompletionHookFn = (
  taskId: string,
  newStatus: string,
  provider: TaskProvider,
  deps?: CompletionHookDeps,
) => Promise<void>

export interface CompletionHookDeps {
  findTemplateByTaskId: (taskId: string) => RecurringTaskRecord | null
  isCompletionStatus: (status: string) => boolean
  recordOccurrence: (templateId: string, taskId: string) => void
  markExecuted: (id: string) => void
}

const defaultCompletionHookDeps: CompletionHookDeps = {
  findTemplateByTaskId: defaultFindTemplateByTaskId,
  isCompletionStatus: defaultIsCompletionStatus,
  recordOccurrence: defaultRecordOccurrence,
  markExecuted: defaultMarkExecuted,
}

const applyLabels = async (provider: TaskProvider, taskId: string, labels: readonly string[]): Promise<void> => {
  if (labels.length === 0) return
  if (!provider.capabilities.has('labels.assign') || provider.addTaskLabel === undefined) return

  const results = await Promise.allSettled(labels.map((labelId) => provider.addTaskLabel!(taskId, labelId)))
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'rejected') {
      log.warn({ taskId, labelId: labels[i], error: result.reason }, 'Failed to apply label')
    }
  }
}

const createNextOccurrence = async (
  template: RecurringTaskRecord,
  taskId: string,
  provider: TaskProvider,
  deps: CompletionHookDeps,
): Promise<void> => {
  try {
    const created = await provider.createTask({
      projectId: template.projectId,
      title: template.title,
      description: template.description ?? undefined,
      priority: template.priority ?? undefined,
      status: template.status ?? undefined,
      assignee: template.assignee ?? undefined,
    })

    await applyLabels(provider, created.id, template.labels)
    deps.recordOccurrence(template.id, created.id)
    deps.markExecuted(template.id)

    log.info(
      { templateId: template.id, createdTaskId: created.id, title: template.title },
      'On-complete recurring task instance created',
    )
  } catch (error) {
    log.error(
      {
        templateId: template.id,
        taskId,
        error: error instanceof Error ? error.message : String(error),
      },
      'Failed to create on_complete recurring task instance',
    )
  }
}

/**
 * After a task is updated to a completion status, check if it was generated
 * from an on_complete recurring template. If so, fire the next occurrence.
 */
export const completionHook: CompletionHookFn = async (
  taskId: string,
  newStatus: string,
  provider: TaskProvider,
  deps: CompletionHookDeps = defaultCompletionHookDeps,
): Promise<void> => {
  if (!deps.isCompletionStatus(newStatus)) return

  log.debug({ taskId, newStatus }, 'Completion status detected, checking for recurring template')

  const template = deps.findTemplateByTaskId(taskId)
  if (template === null) {
    log.debug({ taskId }, 'No recurring template found for completed task')
    return
  }

  if (template.triggerType !== 'on_complete') {
    log.debug({ taskId, templateId: template.id, triggerType: template.triggerType }, 'Template is not on_complete')
    return
  }

  if (!template.enabled) {
    log.debug({ taskId, templateId: template.id }, 'Template is paused, skipping on_complete fire')
    return
  }

  log.info({ taskId, templateId: template.id, title: template.title }, 'Firing on_complete recurring task')
  await createNextOccurrence(template, taskId, provider, deps)
}
