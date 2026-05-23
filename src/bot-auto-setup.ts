// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from './chat/types.js'
import { getConfigKeysForContext } from './config-keys.js'
import { getAllConfig } from './config.js'
import { getContextSettings } from './instances/context-store.js'
import { getTaskInstance } from './instances/task-store.js'
import { startTaskInstanceSelection } from './setup/task-instance-selection.js'
import { isDemoUser } from './users.js'
import { createWizard, hasActiveWizard } from './wizard/index.js'
import { getWizardSteps } from './wizard/steps.js'

function userNeedsSetup(storageContextId: string): boolean {
  const settings = getContextSettings(storageContextId)
  if (settings === null) return true
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return true

  const config = getAllConfig(storageContextId)
  const contextKeys = getConfigKeysForContext(storageContextId)
  return getWizardSteps(taskInstance.type).some((step) => {
    if (step.isOptional === true) return false
    if (!contextKeys.includes(step.key)) return false
    const value = config[step.key]
    if (value === undefined) return true
    if (value === '') return true
    return false
  })
}

export async function autoStartWizardIfNeeded(
  userId: string,
  storageContextId: string,
  reply: ReplyFn,
): Promise<boolean> {
  if (hasActiveWizard(userId, storageContextId)) return false
  if (process.env['DEMO_MODE'] === 'true' && isDemoUser(userId)) return false
  if (!userNeedsSetup(storageContextId)) return false

  const settings = getContextSettings(storageContextId)
  if (settings === null) {
    const selection = startTaskInstanceSelection(userId, storageContextId)
    if (selection.status === 'assigned') {
      const result = createWizard(userId, storageContextId, selection.taskProvider)
      if (result.success) await reply.text(result.prompt)
      return result.success
    }
    if (selection.status === 'pending' || selection.status === 'aborted') {
      await reply.text(selection.response)
      return true
    }
    return false
  }

  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return false
  const result = createWizard(userId, storageContextId, taskInstance.type)
  if (result.success) await reply.text(result.prompt)
  return result.success
}
