// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { logger } from '../logger.js'
import { buildPluginContext } from './context.js'
import { contributionRegistry } from './contributions.js'
import { pluginRegistry } from './registry.js'
import { recordRuntimeEvent } from './store.js'
import type { DiscoveredPlugin, PluginFactory } from './types.js'

function isPluginFactory(value: unknown): value is PluginFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'activate' in value &&
    typeof (value as Record<string, unknown>)['activate'] === 'function'
  )
}

async function importPluginModule(entryPoint: string): Promise<PluginFactory | null> {
  const mod: unknown = await import(entryPoint)
  const candidate = typeof mod === 'object' && mod !== null && 'default' in mod ? mod.default : mod
  if (!isPluginFactory(candidate)) return null
  return candidate
}

function buildActivationTimeout(timeoutMs: number): { promise: Promise<never>; cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Activation timed out after ${timeoutMs}ms`))
    }, timeoutMs)
  })
  return {
    promise,
    cancel() {
      if (timeout !== undefined) clearTimeout(timeout)
    },
  }
}

const log = logger.child({ scope: 'plugins:loader' })
const PLUGIN_LIFECYCLE_CONCURRENCY = 4

/** Default system context ID used during plugin activation (non-user-specific). */
const SYSTEM_CONTEXT_ID = '__system__'

/** Activation order for deterministic reverse deactivation. */
const activationOrder: string[] = []

async function activateOne(plugin: DiscoveredPlugin): Promise<boolean> {
  const { manifest, entryPoint } = plugin

  log.info({ pluginId: manifest.id, entryPoint }, 'Activating plugin')

  const factory = await importPluginModule(entryPoint).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err)
    log.error({ pluginId: manifest.id, error: msg }, 'Failed to import plugin entry point')
    pluginRegistry.markError(manifest.id, `Import failed: ${msg}`)
    recordRuntimeEvent(manifest.id, 'error', `Import failed: ${msg}`)
    return null
  })
  if (factory === null) return false

  const { ctx, collected } = buildPluginContext(manifest, SYSTEM_CONTEXT_ID)
  const activationTimeout = buildActivationTimeout(manifest.activationTimeoutMs)

  try {
    const contributions = await Promise.race([Promise.resolve(factory.activate(ctx)), activationTimeout.promise])

    if (contributions !== undefined && contributions !== null) {
      collected.tools.push(...contributions.tools)
      collected.promptFragments.push(...contributions.promptFragments)
    }

    contributionRegistry.register(manifest.id, collected, manifest)
    pluginRegistry.markActive(manifest.id)
    activationOrder.push(manifest.id)
    recordRuntimeEvent(manifest.id, 'activated')
    log.info({ pluginId: manifest.id }, 'Plugin activated successfully')
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error({ pluginId: manifest.id, error: msg }, 'Plugin activation failed')
    contributionRegistry.deregister(manifest.id)
    pluginRegistry.markError(manifest.id, `Activation failed: ${msg}`)
    recordRuntimeEvent(manifest.id, 'error', `Activation failed: ${msg}`)
    return false
  } finally {
    activationTimeout.cancel()
  }
}

/** Load and activate all approved+compatible plugins. Failures are isolated. */
export async function activatePlugins(plugins: DiscoveredPlugin[]): Promise<void> {
  if (plugins.length === 0) {
    log.debug('No plugins to activate')
    return
  }

  const limit = pLimit(PLUGIN_LIFECYCLE_CONCURRENCY)
  const results = await Promise.all(plugins.map((p) => limit(() => activateOne(p))))
  const activated = results.filter(Boolean).length
  const failed = results.length - activated

  log.info({ activated, failed, total: plugins.length }, 'Plugin activation complete')
}

async function deactivateOne(pluginId: string): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined || entry.state !== 'active') return

  try {
    const factory = await importPluginModule(entry.discoveredPlugin.entryPoint)
    if (factory !== null && typeof factory.deactivate === 'function') {
      const { ctx } = buildPluginContext(entry.discoveredPlugin.manifest, SYSTEM_CONTEXT_ID)
      await Promise.resolve(factory.deactivate(ctx))
    }
    contributionRegistry.deregister(pluginId)
    pluginRegistry.markDeactivated(pluginId)
    recordRuntimeEvent(pluginId, 'deactivated')
    log.info({ pluginId }, 'Plugin deactivated')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error({ pluginId, error: msg }, 'Plugin deactivation error (continuing)')
    contributionRegistry.deregister(pluginId)
    recordRuntimeEvent(pluginId, 'error', `Deactivation error: ${msg}`)
  }
}

/** Deactivate all active plugins in reverse activation order. */
export async function deactivateAllPlugins(): Promise<void> {
  const toDeactivate = [...activationOrder].reverse()
  if (toDeactivate.length === 0) return

  log.info({ count: toDeactivate.length }, 'Deactivating plugins')

  const limit = pLimit(PLUGIN_LIFECYCLE_CONCURRENCY)
  await Promise.all(toDeactivate.map((id) => limit(() => deactivateOne(id))))

  activationOrder.length = 0
  log.info('All plugins deactivated')
}

/** Get currently active plugin IDs. */
export function getActivatedPluginIds(): string[] {
  return [...activationOrder]
}
