// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listTaskInstances, updateTaskInstance } from '../instances/task-store.js'
import { logger } from '../logger.js'
import {
  listContributedTaskProviderTypesForPlugin,
  unregisterContributedTaskProviderType,
} from '../providers/registry.js'

const log = logger.child({ scope: 'plugins:task-provider-lifecycle' })

export type DeactivateContributedTaskProviderTypesDeps = Readonly<{
  listTypesForPlugin: typeof listContributedTaskProviderTypesForPlugin
  unregisterTypesForPlugin: typeof unregisterContributedTaskProviderType
  listTaskInstances: typeof listTaskInstances
  updateTaskInstance: typeof updateTaskInstance
}>

const defaultDeps: DeactivateContributedTaskProviderTypesDeps = {
  listTypesForPlugin: listContributedTaskProviderTypesForPlugin,
  unregisterTypesForPlugin: unregisterContributedTaskProviderType,
  listTaskInstances,
  updateTaskInstance,
}

export function deactivateContributedTaskProviderTypes(
  pluginId: string,
  deps: DeactivateContributedTaskProviderTypesDeps = defaultDeps,
): string[] {
  const providerTypes = deps.listTypesForPlugin(pluginId)
  if (providerTypes.length === 0) return []

  const providerTypeSet = new Set(providerTypes)
  const affectedInstances = deps
    .listTaskInstances()
    .filter((instance) => instance.status === 'active' && providerTypeSet.has(instance.type))

  for (const instance of affectedInstances) {
    deps.updateTaskInstance(instance.id, { config: undefined, status: 'stopped' })
  }

  const removedTypes = deps.unregisterTypesForPlugin(pluginId)
  log.warn(
    { pluginId, providerTypes: removedTypes, stoppedTaskInstanceIds: affectedInstances.map((instance) => instance.id) },
    'Deactivated contributed task provider types',
  )
  return removedTypes
}
