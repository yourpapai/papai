// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listPlatformProviderTypes } from '../chat/registry.js'
import { listContextsByTaskInstance } from '../instances/context-store.js'
import { maskConfig, providerSensitiveKeys, unknownProviderSensitiveKeys } from '../instances/encryption.js'
import type { InstanceConfig, PlatformInstance, TaskInstance } from '../instances/types.js'
import { getTaskProviderDescriptor } from '../providers/registry.js'
import { jsonResponse } from './json-response.js'

export const INSTANCE_ROUTE_MASK = '********'

export const instanceListResponse = (instances: readonly unknown[], unreadable: readonly unknown[]): Response => {
  if (unreadable.length === 0) return jsonResponse(instances)
  return jsonResponse({ instances, unreadable })
}

const platformInstanceSensitiveKeys = (type: string, config: InstanceConfig): ReadonlySet<string> => {
  const descriptor = listPlatformProviderTypes().find((candidate) => candidate.type === type)
  if (descriptor === undefined) return unknownProviderSensitiveKeys(config)
  return providerSensitiveKeys(config, descriptor.instanceConfigSchema)
}

export const maskedPlatformInstance = (instance: PlatformInstance): PlatformInstance => ({
  ...instance,
  config: maskConfig(
    instance.config,
    platformInstanceSensitiveKeys(instance.type, instance.config),
    INSTANCE_ROUTE_MASK,
  ),
})

const taskInstanceSensitiveKeys = (type: string, config: InstanceConfig): ReadonlySet<string> => {
  const descriptor = getTaskProviderDescriptor(type)
  if (descriptor === undefined) return unknownProviderSensitiveKeys(config)
  return providerSensitiveKeys(config, descriptor.instanceConfigSchema)
}

export const maskedTaskInstance = (instance: TaskInstance): TaskInstance => ({
  ...instance,
  config: maskConfig(instance.config, taskInstanceSensitiveKeys(instance.type, instance.config), INSTANCE_ROUTE_MASK),
})

const unresolvedReasonFor = (instance: TaskInstance): string | null =>
  getTaskProviderDescriptor(instance.type) === undefined
    ? `Provider plugin for type '${instance.type}' is not active. Run /plugin approve.`
    : null

export const taskInstanceView = (
  instance: TaskInstance,
): TaskInstance & {
  readonly referencingContextCount: number
  readonly referencingContextIds: readonly string[]
  readonly unresolvedReason: string | null
} => {
  const referencingContextIds = listContextsByTaskInstance(instance.id)
    .map((context) => context.contextId)
    .toSorted((a, b) => a.localeCompare(b))
  return {
    ...maskedTaskInstance(instance),
    referencingContextCount: referencingContextIds.length,
    referencingContextIds,
    unresolvedReason: unresolvedReasonFor(instance),
  }
}
