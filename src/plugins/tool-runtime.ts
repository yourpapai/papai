// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { loadAttachmentRecord } from '../attachments/store.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import {
  resolveAgentSecrets,
  resolveForgeToken,
  resolveAgent,
  configContextOf,
} from '../coding-credentials/resolve-agent-secrets.js'
import { getRepoByName, listRepos } from '../coding-repos/store.js'
import { getPluginConfig } from '../config.js'
import type { TaskProvider } from '../providers/types.js'
import { buildIdentityFacade } from './identity-facade.js'
import { consumePluginQuota } from './rate-limit.js'
import type { PluginScheduledJobRuntimeContext } from './runtime-types.js'
import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from './store.js'
import type {
  PluginAttachmentFacade,
  PluginManifest,
  PluginTaskProviderFacade,
  PluginToolRuntimeContext,
} from './types.js'

export type PluginToolSetRuntime = {
  provider?: TaskProvider
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
      const rows = prefix === undefined ? kvList(pluginId, contextId) : kvList(pluginId, contextId, prefix)
      return rows.map((row) => ({ key: row.key, value: row.value }))
    },
  })
}

function buildRuntimeAdminConfig(pluginId: string, manifest: PluginManifest): PluginToolRuntimeContext['adminConfig'] {
  const adminKeys = new Set(manifest.configRequirements.filter((req) => req.scope === 'admin').map((req) => req.key))

  return Object.freeze({
    get(key: string): string | undefined {
      if (!adminKeys.has(key)) return undefined
      return getPluginAdminConfig(pluginId, key)
    },
  })
}

function buildRuntimeContextConfig(
  pluginId: string,
  contextId: string,
  manifest: PluginManifest,
): PluginToolRuntimeContext['contextConfig'] {
  const contextKeys = new Set(
    manifest.configRequirements.filter((req) => req.scope === 'context').map((req) => req.key),
  )
  return Object.freeze({
    get(key: string): string | undefined {
      if (!contextKeys.has(key)) return undefined
      return getPluginConfig(contextId, pluginId, key) ?? undefined
    },
  })
}

export function buildPluginTaskProviderFacade(
  pluginId: string,
  provider: TaskProvider | undefined,
  canRead: boolean,
  canWrite: boolean,
): PluginTaskProviderFacade {
  return Object.freeze({
    getTask(taskId: string) {
      if (!canRead) deny(pluginId, 'tasks.read')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      return provider.getTask(taskId)
    },
    listTasks(projectId: string, params) {
      if (!canRead) deny(pluginId, 'tasks.read')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      return provider.listTasks(projectId, params)
    },
    searchTasks(params) {
      if (!canRead) deny(pluginId, 'tasks.read')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      return provider.searchTasks(params)
    },
    createTask(params) {
      if (!canWrite) deny(pluginId, 'tasks.write')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      return provider.createTask(params)
    },
    updateTask(taskId: string, params) {
      if (!canWrite) deny(pluginId, 'tasks.write')
      if (provider === undefined) throw new Error(`Plugin ${pluginId} task provider unavailable`)
      return provider.updateTask(taskId, params)
    },
  }) satisfies PluginTaskProviderFacade
}

function buildAttachmentsFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
): PluginAttachmentFacade {
  return Object.freeze({
    async read(attachmentId: string) {
      if (!hasPermission) deny(pluginId, 'attachments.read')
      const stored = await loadAttachmentRecord(storageContextId, attachmentId)
      if (stored === null) {
        throw new Error('attachment_not_found')
      }
      return {
        record: {
          attachmentId: stored.attachmentId,
          filename: stored.filename,
          mimeType: stored.mimeType,
          size: stored.size,
          createdAt: stored.createdAt,
          ...(stored.origin === undefined ? {} : { origin: stored.origin }),
          ...(stored.forwardedFrom === undefined ? {} : { forwardedFrom: stored.forwardedFrom }),
        },
        bytes: stored.content,
      }
    },
  })
}

export function buildCodingSecretsFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
): PluginToolRuntimeContext['codingSecrets'] {
  return Object.freeze({
    resolve(): Record<string, string> | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return resolveAgentSecrets(storageContextId)
    },
    resolveForgeToken(): string | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return resolveForgeToken(storageContextId)
    },
    resolveAgent(): string | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return resolveAgent(storageContextId)
    },
  })
}

export function buildCodingReposFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
): PluginToolRuntimeContext['codingRepos'] {
  return Object.freeze({
    list(): { name: string; baseBranch: string }[] {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const contextId = configContextOf(storageContextId)
      return listRepos(contextId).map((r) => ({ name: r.name, baseBranch: r.baseBranch }))
    },
    get(name: string): { name: string; repoUrl: string; baseBranch: string; permissionPreset: string } | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const contextId = configContextOf(storageContextId)
      const r = getRepoByName(contextId, name)
      if (r === null) return null
      return { name: r.name, repoUrl: r.repoUrl, baseBranch: r.baseBranch, permissionPreset: r.permissionPreset }
    },
  })
}

export function buildPluginScheduledJobRuntimeContext(
  pluginId: string,
  contextId: string,
  manifest: PluginManifest,
  provider: TaskProvider | undefined,
): PluginScheduledJobRuntimeContext {
  if (provider === undefined) return { pluginId, contextId }

  return {
    pluginId,
    contextId,
    taskProvider: buildPluginTaskProviderFacade(
      pluginId,
      provider,
      manifest.permissions.includes('tasks.read'),
      manifest.permissions.includes('tasks.write'),
    ),
  }
}

// Dedicated plugin self-throttle bucket, SEPARATE from web_fetch's quota so the
// two never drain each other. Keyed per (plugin, actor); callers should pass a
// per-user actor id so one user cannot starve a shared group context.
// Ungated: rate limiting is a safety mechanism, not a capability — any plugin may self-throttle.
function buildRateLimit(pluginId: string): PluginToolRuntimeContext['rateLimit'] {
  return Object.freeze({
    check(actorId: string): { allowed: boolean; retryAfterSec?: number } {
      const result = consumePluginQuota(pluginId, actorId)
      if (result.allowed) return { allowed: true }
      return { allowed: false, retryAfterSec: result.retryAfterSec }
    },
  })
}

const buildRuntimeIdentity = (manifest: PluginManifest, chatUserId: string): PluginToolRuntimeContext['identity'] => {
  const [providerType] = manifest.contributes.taskProviderTypes
  if (!manifest.permissions.includes('identity')) return undefined
  if (manifest.contributes.taskProviderTypes.length !== 1 || providerType === undefined) return undefined
  return buildIdentityFacade(providerType, chatUserId)
}

export function buildPluginToolRuntimeContext(
  pluginId: string,
  manifest: PluginManifest,
  runtime: PluginToolSetRuntime,
): PluginToolRuntimeContext {
  const permissions = new Set(manifest.permissions)
  // Group-scoped plugins key their KV by the config-context id so durable state
  // (e.g. transcript caches) is shared across a group's sibling threads instead
  // of re-derived per thread. Attachment reads still use the raw storage context.
  const kvContextId =
    manifest.storageScope === 'group'
      ? getConfigContextIdFromStorageContextId(runtime.storageContextId)
      : runtime.storageContextId
  const identity = buildRuntimeIdentity(manifest, runtime.chatUserId)
  const taskProvider =
    runtime.provider === undefined
      ? undefined
      : buildPluginTaskProviderFacade(
          pluginId,
          runtime.provider,
          permissions.has('tasks.read'),
          permissions.has('tasks.write'),
        )
  return Object.freeze({
    pluginId,
    storageContextId: runtime.storageContextId,
    chatUserId: runtime.chatUserId,
    kv: buildRuntimeKv(pluginId, kvContextId, permissions.has('storage')),
    adminConfig: buildRuntimeAdminConfig(pluginId, manifest),
    contextConfig: buildRuntimeContextConfig(pluginId, runtime.storageContextId, manifest),
    ...(taskProvider === undefined ? {} : { taskProvider }),
    ...(identity === undefined ? {} : { identity }),
    rateLimit: buildRateLimit(pluginId),
    attachments: buildAttachmentsFacade(pluginId, runtime.storageContextId, permissions.has('attachments.read')),
    codingSecrets: buildCodingSecretsFacade(pluginId, runtime.storageContextId, permissions.has('coding.secrets')),
    codingRepos: buildCodingReposFacade(pluginId, runtime.storageContextId, permissions.has('coding.secrets')),
  })
}
