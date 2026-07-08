// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  configContextOf,
  resolveAgent,
  resolveAgentSecrets,
  resolveForge,
  resolveForgeToken,
  resolveMcp,
  resolveMcpToken,
  resolveModel,
  resolveProviderHost,
} from '../coding-credentials/resolve-agent-secrets.js'
import { getRepoByName, listRepos } from '../coding-repos/store.js'
import { deny } from './deny.js'
import type { CodingRepoEntry } from './runtime-types.js'
import type { PluginToolRuntimeContext } from './types.js'

export function buildCodingSecretsFacade(
  pluginId: string,
  storageContextId: string,
  hasPermission: boolean,
  chatUserId: string,
): PluginToolRuntimeContext['codingSecrets'] {
  // Gate each resolver behind the coding.secrets permission check.
  const gate =
    <T>(fn: () => T): (() => T) =>
    (): T => {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      return fn()
    }
  return Object.freeze({
    resolve: gate(() => resolveAgentSecrets(storageContextId, chatUserId)),
    resolveForgeToken: gate(() => resolveForgeToken(storageContextId, chatUserId)),
    resolveAgent: gate(() => resolveAgent(storageContextId, chatUserId)),
    resolveForge: gate(() => resolveForge(storageContextId, chatUserId)),
    resolveProviderHost: gate(() => resolveProviderHost(storageContextId, chatUserId)),
    resolveModel: gate(() => resolveModel(storageContextId, chatUserId)),
    resolveMcp: gate(() => resolveMcp(storageContextId, chatUserId)),
    resolveMcpToken: gate(() => resolveMcpToken(storageContextId, chatUserId)),
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
    get(name: string): CodingRepoEntry | null {
      if (!hasPermission) deny(pluginId, 'coding.secrets')
      const contextId = configContextOf(storageContextId)
      const r = getRepoByName(contextId, name)
      if (r === null) return null
      return {
        name: r.name,
        repoUrl: r.repoUrl,
        baseBranch: r.baseBranch,
        permissionPreset: r.permissionPreset,
        additionalEgressDomains: r.additionalEgressDomains,
      }
    },
  })
}
