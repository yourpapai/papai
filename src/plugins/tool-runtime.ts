// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TaskProvider } from '../providers/types.js'
import { consumeWebFetchQuota } from '../web/rate-limit.js'
import { kvDelete, kvGet, kvList, kvSet } from './store.js'
import type { PluginManifest, PluginTaskProviderFacade, PluginToolRuntimeContext } from './types.js'

export type PluginToolSetRuntime = {
  provider: TaskProvider
  storageContextId: string
  chatUserId: string
}

function deny(pluginId: string, permission: string): never {
  throw new Error(`Plugin ${pluginId} does not have '${permission}' permission`)
}

function buildRuntimeKv(
  pluginId: string,
  contextId: string,
  hasStoragePermission: boolean,
): PluginToolRuntimeContext['kv'] {
  if (!hasStoragePermission) {
    const denyStorage = (): never => deny(pluginId, 'storage')
    return Object.freeze({
      get: denyStorage,
      set: denyStorage,
      delete: denyStorage,
      list: denyStorage,
    })
  }

  return Object.freeze({
    get(key: string): string | undefined {
      return kvGet(pluginId, contextId, key)
    },
    set(key: string, value: string): void {
      kvSet(pluginId, contextId, key, value)
    },
    delete(key: string): void {
      kvDelete(pluginId, contextId, key)
    },
    list(prefix?: string): Array<{ key: string; value: string }> {
      return kvList(pluginId, contextId, prefix).map((row) => ({ key: row.key, value: row.value }))
    },
  })
}

function buildTaskProviderFacade(
  pluginId: string,
  provider: TaskProvider,
  canRead: boolean,
  canWrite: boolean,
): PluginTaskProviderFacade {
  return Object.freeze({
    getTask(taskId: string) {
      if (!canRead) deny(pluginId, 'tasks.read')
      return provider.getTask(taskId)
    },
    listTasks(projectId: string, params) {
      if (!canRead) deny(pluginId, 'tasks.read')
      return provider.listTasks(projectId, params)
    },
    searchTasks(params) {
      if (!canRead) deny(pluginId, 'tasks.read')
      return provider.searchTasks(params)
    },
    createTask(params) {
      if (!canWrite) deny(pluginId, 'tasks.write')
      return provider.createTask(params)
    },
    updateTask(taskId: string, params) {
      if (!canWrite) deny(pluginId, 'tasks.write')
      return provider.updateTask(taskId, params)
    },
  }) satisfies PluginTaskProviderFacade
}

function buildRateLimit(): PluginToolRuntimeContext['rateLimit'] {
  return Object.freeze({
    check(actorId: string): { allowed: boolean; retryAfterSec?: number } {
      const result = consumeWebFetchQuota(actorId)
      if (result.allowed) return { allowed: true }
      return { allowed: false, retryAfterSec: result.retryAfterSec }
    },
  })
}

export function buildPluginToolRuntimeContext(
  pluginId: string,
  manifest: PluginManifest,
  runtime: PluginToolSetRuntime,
): PluginToolRuntimeContext {
  const permissions = new Set(manifest.permissions)
  return Object.freeze({
    pluginId,
    storageContextId: runtime.storageContextId,
    chatUserId: runtime.chatUserId,
    taskProvider: buildTaskProviderFacade(
      pluginId,
      runtime.provider,
      permissions.has('tasks.read'),
      permissions.has('tasks.write'),
    ),
    kv: buildRuntimeKv(pluginId, runtime.storageContextId, permissions.has('storage')),
    rateLimit: buildRateLimit(),
  })
}
