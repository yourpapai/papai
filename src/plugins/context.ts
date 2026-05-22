// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from '../logger.js'
import { kvDelete, kvGet, kvList, kvSet } from './store.js'
import type {
  PluginContributions,
  PluginManifest,
  PluginPermission,
  PluginTool,
  PluginPromptFragment,
} from './types.js'

const log = logger.child({ scope: 'plugins:context' })

/** Context-scoped KV store exposed to a plugin. */
export type PluginKvStore = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  delete(key: string): void
  list(prefix?: string): Array<{ key: string; value: string }>
}

/** Logger facade exposed to plugins. */
export type PluginLogger = {
  debug(data: Record<string, unknown>, msg: string): void
  info(data: Record<string, unknown>, msg: string): void
  warn(data: Record<string, unknown>, msg: string): void
  error(data: Record<string, unknown>, msg: string): void
}

/** Registration API given to a plugin's activate() function. */
export type PluginRegistration = {
  /** Register a tool contribution. The name must match a declared contributes.tools entry. */
  registerTool(tool: PluginTool): void
  /** Register a prompt fragment. The name must match a declared contributes.promptFragments entry. */
  registerPromptFragment(fragment: PluginPromptFragment): void
}

/** Full context passed to a plugin's activate() function. */
export type PluginContext = {
  readonly pluginId: string
  readonly contextId: string
  readonly permissions: ReadonlySet<PluginPermission>
  readonly kv: PluginKvStore
  readonly log: PluginLogger
  readonly registration: PluginRegistration
}

function buildKvStore(pluginId: string, contextId: string): PluginKvStore {
  return {
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
  }
}

function buildPluginLogger(pluginId: string): PluginLogger {
  const scopedLog = logger.child({ scope: 'plugin', pluginId })
  return {
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
  }
}

function buildRegistration(manifest: PluginManifest, collected: PluginContributions): PluginRegistration {
  const declaredTools = new Set(manifest.contributes.tools)
  const declaredFragments = new Set(manifest.contributes.promptFragments)

  return {
    registerTool(pluginTool: PluginTool): void {
      if (!declaredTools.has(pluginTool.name)) {
        log.warn({ pluginId: manifest.id, toolName: pluginTool.name }, 'Undeclared tool registration rejected')
        return
      }
      collected.tools.push(pluginTool)
    },
    registerPromptFragment(fragment: PluginPromptFragment): void {
      if (!declaredFragments.has(fragment.name)) {
        log.warn(
          { pluginId: manifest.id, fragmentName: fragment.name },
          'Undeclared prompt fragment registration rejected',
        )
        return
      }
      collected.promptFragments.push(fragment)
    },
  }
}

/**
 * Build a PluginContext for use during plugin activation.
 * Returns the context and the collected contributions (populated during activate()).
 */
export function buildPluginContext(
  manifest: PluginManifest,
  contextId: string,
): { ctx: PluginContext; collected: PluginContributions } {
  const permissions = new Set(manifest.permissions) as ReadonlySet<PluginPermission>
  const collected: PluginContributions = { tools: [], promptFragments: [] }

  const kv = permissions.has('storage') ? buildKvStore(manifest.id, contextId) : buildDeniedKvStore(manifest.id)

  const ctx: PluginContext = Object.freeze({
    pluginId: manifest.id,
    contextId,
    permissions,
    kv,
    log: buildPluginLogger(manifest.id),
    registration: buildRegistration(manifest, collected),
  })

  return { ctx, collected }
}

function buildDeniedKvStore(pluginId: string): PluginKvStore {
  const deny = (): never => {
    throw new Error(`Plugin ${pluginId} does not have 'storage' permission`)
  }
  return { get: deny, set: deny, delete: deny, list: deny }
}
