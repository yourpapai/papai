// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { InstanceStatus } from '../instances/types.js'
import type { ManagedChatInstance } from './router-types.js'
import type { ChatProviderTraits, ContextRendered, ThreadCapabilities } from './types.js'

export const activeInstanceStatuses = new Set<InstanceStatus>(['active', 'pending'])

export const fallbackThreadCapabilities: ThreadCapabilities = {
  supportsThreads: false,
  canCreateThreads: false,
  threadScope: 'message',
}

export const fallbackTraits: ChatProviderTraits = { observedGroupMessages: 'all' }

export const fallbackContextRendered: ContextRendered = {
  method: 'text',
  content: 'No active chat provider is available to render this context.',
}

export const activeManagedInstances = (instances: Iterable<ManagedChatInstance>): ManagedChatInstance[] =>
  [...instances].filter((instance) => activeInstanceStatuses.has(instance.status))

export const firstActiveManagedInstance = (instances: Iterable<ManagedChatInstance>): ManagedChatInstance | null => {
  const instance = activeManagedInstances(instances)[0]
  if (instance === undefined) return null
  return instance
}

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))
