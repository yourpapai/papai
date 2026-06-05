// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listContributedChatProviderTypesForPlugin, unregisterContributedChatProviderType } from '../chat/registry.js'
import { listActivePlatformInstancesSafe } from '../instances/platform-store.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'plugins:chat-provider-lifecycle' })

export function unregisterContributedChatProviderTypes(pluginId: string): string[] {
  const removedTypes = unregisterContributedChatProviderType(pluginId)
  if (removedTypes.length > 0) {
    log.info({ pluginId, providerTypes: removedTypes }, 'Unregistered contributed chat provider types')
  }
  return removedTypes
}

export function deactivateContributedChatProviderTypes(pluginId: string): string[] {
  const providerTypes = listContributedChatProviderTypesForPlugin(pluginId)
  if (providerTypes.length === 0) return []

  const providerTypeSet = new Set(providerTypes)
  const affectedInstances = listActivePlatformInstancesSafe().instances.filter((instance) =>
    providerTypeSet.has(instance.type),
  )

  const removedTypes = unregisterContributedChatProviderTypes(pluginId)
  log.warn(
    { pluginId, providerTypes: removedTypes, affectedInstanceIds: affectedInstances.map((i) => i.id) },
    'Deactivated contributed chat provider types',
  )
  return removedTypes
}
