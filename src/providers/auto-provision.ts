// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn } from '../chat/types.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import { getTaskProviderDescriptor } from './registry.js'

export function maybeAutoProvisionProvider(
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
): Promise<boolean> {
  const settings = getContextSettings(contextId)
  if (settings === null) return Promise.resolve(false)

  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active') return Promise.resolve(false)

  const descriptor = getTaskProviderDescriptor(taskInstance.type)
  if (descriptor?.autoProvision === undefined) return Promise.resolve(false)

  return Promise.resolve(descriptor.autoProvision({ contextId, chatUserId, username, reply }))
}
