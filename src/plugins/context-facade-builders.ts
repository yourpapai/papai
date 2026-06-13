// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import type { PluginAdminConfig, PluginKvStore, PluginLogger } from './context.js'
import { buildContextDynamicHosts, buildDynamicHosts } from './dynamic-hosts.js'
import { buildProviderRuntime, type PluginProviderRuntime } from './provider-runtime.js'
import { getPluginAdminConfig, kvDelete, kvGet, kvList, kvSet } from './store.js'
import type { PluginManifest } from './types.js'

export function buildAdminConfig(manifest: PluginManifest): PluginAdminConfig {
  const adminKeys = new Set(manifest.configRequirements.filter((req) => req.scope === 'admin').map((req) => req.key))
  return Object.freeze({
    get(key: string): string | undefined {
      if (!adminKeys.has(key)) return undefined
      return getPluginAdminConfig(manifest.id, key)
    },
  })
}

export function buildKvStore(pluginId: string, contextId: string): PluginKvStore {
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

export function buildPluginLogger(pluginId: string): PluginLogger {
  const scopedLog = logger.child({ scope: 'plugin', pluginId })
  return Object.freeze({
    debug(data: Record<string, unknown>, msg: string): void {
      scopedLog.debug(data, msg)
    },
    info(data: Record<string, unknown>, msg: string): void {
      scopedLog.info(data, msg)
    },
    warn(data: Record<string, unknown>, msg: string): void {
      scopedLog.warn(data, msg)
    },
    error(data: Record<string, unknown>, msg: string): void {
      scopedLog.error(data, msg)
    },
  })
}

/** Build the provider runtime for a manifest, wiring both admin and context dynamic host tiers. */
export function buildManifestProviderRuntime(manifest: PluginManifest, log: PluginLogger): PluginProviderRuntime {
  return buildProviderRuntime(
    manifest.providerAllowedHosts,
    log,
    undefined,
    buildDynamicHosts(manifest),
    buildContextDynamicHosts(manifest),
  )
}

export function buildDeniedKvStore(pluginId: string): PluginKvStore {
  const deny = (): never => {
    throw new Error(`Plugin ${pluginId} does not have 'storage' permission`)
  }
  return Object.freeze({ get: deny, set: deny, delete: deny, list: deny })
}
