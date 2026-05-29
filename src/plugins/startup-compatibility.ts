// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import type { ChatCapability } from '../chat/types.js'
import type { PlatformInstance, TaskInstance } from '../instances/types.js'
import { getCapabilitiesForTaskInstance } from '../providers/registry.js'
import type { TaskCapability } from '../providers/types.js'
import type { PluginCompatibilityInstance } from './registry.js'

const EMPTY_TASK_CAPABILITIES: ReadonlySet<TaskCapability> = new Set()
const EMPTY_CHAT_CAPABILITIES: ReadonlySet<ChatCapability> = new Set()

const activeTaskCapabilitySets = (taskInstances: readonly TaskInstance[]): readonly ReadonlySet<TaskCapability>[] =>
  taskInstances.flatMap((instance) => {
    if (instance.status !== 'active') return []
    try {
      return [getCapabilitiesForTaskInstance(instance)]
    } catch {
      return []
    }
  })

const activeChatCapabilitySets = (
  router: ChatRouter,
  platformInstances: readonly PlatformInstance[],
): readonly ReadonlySet<ChatCapability>[] =>
  platformInstances
    .filter((instance) => instance.status === 'active')
    .map((instance) => router.getPlatformInstanceCapabilities(instance.id))

export const buildCompatibilityInstances = (
  taskCapabilities: readonly ReadonlySet<TaskCapability>[],
  chatCapabilities: readonly ReadonlySet<ChatCapability>[],
): readonly PluginCompatibilityInstance[] => {
  const taskSets = taskCapabilities.length === 0 ? [EMPTY_TASK_CAPABILITIES] : taskCapabilities
  const chatSets = chatCapabilities.length === 0 ? [EMPTY_CHAT_CAPABILITIES] : chatCapabilities
  return taskSets.flatMap((taskSet) =>
    chatSets.map((chatSet) => ({ taskCapabilities: taskSet, chatCapabilities: chatSet })),
  )
}

export const collectStartupCompatibilityInstances = (
  router: ChatRouter,
  taskInstances: readonly TaskInstance[],
  platformInstances: readonly PlatformInstance[],
): readonly PluginCompatibilityInstance[] =>
  buildCompatibilityInstances(
    activeTaskCapabilitySets(taskInstances),
    activeChatCapabilitySets(router, platformInstances),
  )
