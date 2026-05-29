// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfigValue } from '../config.js'
import { getContextSettings } from '../instances/context-store.js'
import { getTaskInstance } from '../instances/task-store.js'
import type { TaskInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { getKaneoWorkspace } from '../users.js'
import { createProvider, getTaskProviderDescriptor } from './registry.js'
import type { TaskProviderTypeDescriptor } from './registry.js'
import type { ProviderConfigField, TaskProvider } from './types.js'

const log = logger.child({ scope: 'provider:resolver' })

export interface TaskProviderResolverDeps {
  getContextSettings: typeof getContextSettings
  getTaskInstance: typeof getTaskInstance
  /** Wider than `typeof getConfig`: resolver must look up arbitrary contributed-type field names. */
  getConfig: (contextId: string, key: string) => string | null
  getKaneoWorkspace: typeof getKaneoWorkspace
  getTaskProviderDescriptor: typeof getTaskProviderDescriptor
  createProvider: typeof createProvider
}

const defaultDeps: TaskProviderResolverDeps = {
  getContextSettings,
  getTaskInstance,
  getConfig: getConfigValue,
  getKaneoWorkspace,
  getTaskProviderDescriptor,
  createProvider,
}

const storageKeyForField = (descriptor: TaskProviderTypeDescriptor, field: ProviderConfigField): string => {
  if (descriptor.source !== 'builtin') return `plugin:${descriptor.source.plugin}:provider:${field.key}`
  return field.storageKey ?? field.key
}

const readContextScopedField = (
  descriptor: TaskProviderTypeDescriptor,
  field: ProviderConfigField,
  contextId: string,
  deps: TaskProviderResolverDeps,
): string | null => {
  if (descriptor.type === 'kaneo' && field.key === 'workspaceId') return deps.getKaneoWorkspace(contextId)
  return deps.getConfig(contextId, storageKeyForField(descriptor, field))
}

const readInstanceScopedField = (instance: TaskInstance, fieldKey: string): string | undefined => {
  const value = instance.config[fieldKey]
  if (value !== undefined) return value
  // Back-compat: some instances persist the URL under the legacy `url` key.
  if (fieldKey === 'baseUrl') return instance.config['url']
  return undefined
}

const buildConfigFromDescriptor = (
  contextId: string,
  instance: TaskInstance,
  descriptor: TaskProviderTypeDescriptor,
  deps: TaskProviderResolverDeps,
): Record<string, string> | null => {
  const merged: Record<string, string> = {}
  const missing: string[] = []
  for (const field of descriptor.instanceConfigSchema) {
    const raw = readInstanceScopedField(instance, field.key)
    if (raw !== undefined && raw !== '') {
      merged[field.key] = raw
    } else if (field.required) {
      missing.push(field.key)
    }
  }
  for (const field of descriptor.contextConfigSchema) {
    const raw = readContextScopedField(descriptor, field, contextId, deps) ?? undefined
    if (raw !== undefined && raw !== '') {
      merged[field.key] = raw
    } else if (field.required) {
      missing.push(field.key)
    }
  }
  if (missing.length > 0) {
    log.warn(
      { contextId, taskInstanceId: instance.id, taskProvider: instance.type, missing },
      'Cannot resolve task provider: missing config',
    )
    return null
  }
  return merged
}

export class TaskProviderResolver {
  private readonly deps: TaskProviderResolverDeps

  constructor(deps: Partial<TaskProviderResolverDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps }
  }

  resolve(contextId: string): TaskProvider | null {
    const settings = this.deps.getContextSettings(contextId)
    if (settings === null) {
      log.warn({ contextId }, 'Cannot resolve task provider: context has no task assignment')
      return null
    }

    const instance = this.deps.getTaskInstance(settings.taskInstanceId)
    if (instance === null) {
      log.warn({ contextId, taskInstanceId: settings.taskInstanceId }, 'Cannot resolve task provider: instance missing')
      return null
    }
    if (instance.status !== 'active') {
      log.warn(
        { contextId, taskInstanceId: instance.id, status: instance.status },
        'Cannot resolve task provider: instance is not active',
      )
      return null
    }

    const descriptor = this.deps.getTaskProviderDescriptor(instance.type)
    const config =
      descriptor === undefined
        ? { ...instance.config }
        : buildConfigFromDescriptor(contextId, instance, descriptor, this.deps)
    if (config === null) return null

    log.info({ contextId, taskInstanceId: instance.id, taskProvider: instance.type }, 'Task provider resolved')
    try {
      return this.deps.createProvider(instance.type, config)
    } catch (error) {
      log.warn(
        {
          contextId,
          taskInstanceId: instance.id,
          taskProvider: instance.type,
          error: error instanceof Error ? error.message : String(error),
        },
        'Cannot resolve task provider: provider creation failed',
      )
      return null
    }
  }

  resolveStrict(contextId: string): TaskProvider {
    const provider = this.resolve(contextId)
    if (provider === null) throw new Error(`Context ${contextId} needs /setup`)
    return provider
  }
}

export const defaultTaskProviderResolver = new TaskProviderResolver()
