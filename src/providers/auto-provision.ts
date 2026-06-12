// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { getTaskProviderDescriptor } from './registry.js'

export async function maybeAutoProvisionProvider(
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
): Promise<boolean> {
  const settings = getContextSettings(contextId)
  if (settings === null) return false

  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return false

  const descriptor = getTaskProviderDescriptor(taskInstance.type)
  if (descriptor === undefined || descriptor.autoProvision === undefined) return false

  try {
    return await descriptor.autoProvision({ contextId, chatUserId, username, reply })
  } catch {
    return false
  }
}
