// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { setContextSettings } from '../instances/context-store.js'
import { listTaskInstances } from '../instances/task-store.js'
import type { TaskInstance, TaskInstanceType } from '../instances/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'setup:task-instance-selection' })

type SelectionSession = {
  userId: string
  contextId: string
  platformInstanceId: string
  options: readonly TaskInstance[]
}

export type TaskInstanceSelectionResult =
  | { status: 'assigned'; taskProvider: TaskInstanceType }
  | { status: 'pending'; response: string }
  | { status: 'aborted'; response: string }
  | { status: 'not-handled' }

const sessions = new Map<string, SelectionSession>()

const sessionKey = (userId: string, contextId: string): string => `${userId}:${contextId}`

const activeTaskInstances = (): TaskInstance[] => listTaskInstances().filter((instance) => instance.status === 'active')

const formatChoiceList = (instances: readonly TaskInstance[]): string =>
  [
    'Choose a task tracker for this context.',
    '',
    ...instances.map(
      (instance, index) => `${String(index + 1)}. ${instance.id} (${instance.type}, created ${instance.createdAt})`,
    ),
    '',
    'Reply with one of these task instance IDs.',
  ].join('\n')

const assignTaskInstance = (
  userId: string,
  contextId: string,
  platformInstanceId: string,
  instance: TaskInstance,
): TaskInstanceSelectionResult => {
  setContextSettings({ contextId, taskInstanceId: instance.id, platformInstanceId })
  sessions.delete(sessionKey(userId, contextId))
  log.info({ userId, contextId, taskInstanceId: instance.id, platformInstanceId }, 'Task instance assigned')
  return { status: 'assigned', taskProvider: instance.type }
}

export function startTaskInstanceSelection(
  userId: string,
  contextId: string,
  platformInstanceId: string,
): TaskInstanceSelectionResult {
  const options = activeTaskInstances()
  if (options.length === 0) {
    return {
      status: 'aborted',
      response: 'No task trackers are configured. Ask a super-admin to add one in the dashboard.',
    }
  }
  if (options.length === 1) {
    const only = options[0]!
    log.info(
      { userId, contextId, taskInstanceId: only.id, platformInstanceId },
      'Auto-selecting only active task instance',
    )
    return assignTaskInstance(userId, contextId, platformInstanceId, only)
  }
  sessions.set(sessionKey(userId, contextId), { userId, contextId, platformInstanceId, options })
  return { status: 'pending', response: formatChoiceList(options) }
}

export function handleTaskInstanceSelectionMessage(
  userId: string,
  contextId: string,
  text: string,
): TaskInstanceSelectionResult {
  const session = sessions.get(sessionKey(userId, contextId))
  if (session === undefined) return { status: 'not-handled' }

  const selectedId = text.trim()
  const selected = session.options.find((instance) => instance.id === selectedId)
  if (selected === undefined) {
    return { status: 'pending', response: formatChoiceList(session.options) }
  }
  return assignTaskInstance(userId, contextId, session.platformInstanceId, selected)
}
