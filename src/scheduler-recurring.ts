// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { resolveDeliveryPlatformInstanceId } from './chat/delivery-routing.js'
import { parseScopedContextId } from './chat/scoped-context.js'
import type { ChatProvider } from './chat/types.js'
import { dmTarget } from './chat/types.js'
import { emitUser } from './debug/event-bus.js'
import { logger } from './logger.js'
import type { Task, TaskProvider } from './providers/types.js'
import { recordOccurrence } from './recurring-occurrences.js'
import { markExecuted, type RecurringTaskRecord } from './recurring.js'

const log = logger.child({ scope: 'scheduler:recurring' })

type CreateTaskInput = Parameters<TaskProvider['createTask']>[0]

const getRecurringNotificationRoute = (
  userId: string,
): { platformInstanceId: string; target: ReturnType<typeof dmTarget> } | null => {
  const scoped = parseScopedContextId(userId)
  if (scoped !== null)
    return { platformInstanceId: scoped.platformInstanceId, target: dmTarget(scoped.nativeContextId) }

  const target = dmTarget(userId)
  const platformInstanceId = resolveDeliveryPlatformInstanceId(target)
  if (platformInstanceId === null) return null
  return { platformInstanceId, target }
}

export const buildRecurringTaskInput = (
  ...args: [task: RecurringTaskRecord] | [task: RecurringTaskRecord, dueDate: string]
): CreateTaskInput => {
  const [task, dueDate] = args
  const taskInput: CreateTaskInput = {
    projectId: task.projectId,
    title: task.title,
    ...(task.description === null ? {} : { description: task.description }),
    ...(task.priority === null ? {} : { priority: task.priority }),
    ...(task.status === null ? {} : { status: task.status }),
    ...(task.assignee === null ? {} : { assignee: task.assignee }),
  }

  if (dueDate === undefined) return taskInput
  return { ...taskInput, dueDate }
}

export const applyLabels = async (provider: TaskProvider, taskId: string, labels: readonly string[]): Promise<void> => {
  if (labels.length === 0) return
  if (!provider.capabilities.has('labels.assign') || provider.addTaskLabel === undefined) return

  const results = await Promise.allSettled(labels.map((labelId) => provider.addTaskLabel!(taskId, labelId)))
  for (let i = 0; i < results.length; i++) {
    const result = results[i]!
    if (result.status === 'fulfilled') {
      log.debug({ taskId, labelId: labels[i] }, 'Label applied to recurring task instance')
      continue
    }

    log.warn({ taskId, labelId: labels[i], error: result.reason }, 'Failed to apply label')
  }
}

export const notifyUser = async (
  chatProviderRef: ChatProvider | null,
  userId: string,
  created: Task,
): Promise<void> => {
  if (chatProviderRef === null) return

  const route = getRecurringNotificationRoute(userId)
  if (route === null) return

  try {
    const delivered = await chatProviderRef.sendMessage(
      route.platformInstanceId,
      route.target,
      `Recurring task created: **${created.title}** in project.`,
    )
    if (delivered === false) {
      log.warn(
        { userId, platformInstanceId: route.platformInstanceId, taskId: created.id },
        'Recurring task notification refused',
      )
    }
  } catch (notifyError) {
    log.warn(
      { userId, error: notifyError instanceof Error ? notifyError.message : String(notifyError) },
      'Failed to notify user about recurring task',
    )
  }
}

export const finalizeCreatedRecurringTask = async (
  task: RecurringTaskRecord,
  provider: TaskProvider,
  created: Task,
  chatProviderRef: ChatProvider | null,
): Promise<void> => {
  log.info(
    { recurringTaskId: task.id, createdTaskId: created.id, title: task.title },
    'Recurring task instance created',
  )
  emitUser('scheduler:task_executed', task.userId, { recurringTaskId: task.id, createdTaskId: created.id })
  emitUser('recurring:fired', task.userId, { recurringTaskId: task.id, createdTaskId: created.id })
  emitUser('notify:scheduler_fired', task.userId, { recurringTaskId: task.id })

  await applyLabels(provider, created.id, task.labels)
  recordOccurrence(task.id, created.id)
  markExecuted(task.id)
  await notifyUser(chatProviderRef, task.userId, created)
}
