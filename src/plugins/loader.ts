// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getChatProviderDescriptor, registerContributedChatProviderType } from '../chat/registry.js'
import { logger } from '../logger.js'
import type { TaskProviderConfigValidator } from '../providers/registry.js'
import { getTaskProviderDescriptor, registerContributedTaskProviderType } from '../providers/registry.js'
import {
  deactivateContributedChatProviderTypes,
  unregisterContributedChatProviderTypes,
} from './chat-provider-lifecycle.js'
import { buildPluginContext, runWithClosedRegistration } from './context.js'
import { contributionRegistry } from './contributions.js'
import { importPluginModule, resolveProviderConfigValidator, toPluginImportSpecifier } from './module-import.js'
import { pluginRegistry } from './registry.js'
import { recordRuntimeEvent } from './store.js'
import {
  deactivateContributedTaskProviderTypes,
  unregisterContributedTaskProviderTypes,
} from './task-provider-lifecycle.js'
import type { DiscoveredPlugin, PluginInstance } from './types.js'

function buildActivationTimeout(timeoutMs: number): {
  promise: Promise<never>
  cancel: () => void
} {
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
const PLUGIN_LIFECYCLE_CONCURRENCY = 1
const SYSTEM_CONTEXT_ID = '__system__'
const activationOrder: string[] = []
const activeInstances = new Map<string, PluginInstance>()

function removeActivatedPluginId(pluginId: string): void {
  const index = activationOrder.lastIndexOf(pluginId)
  if (index >= 0) activationOrder.splice(index, 1)
}

function commitTaskProviderRegistration(
  plugin: DiscoveredPlugin,
  ctx: ReturnType<typeof buildPluginContext>,
  validateConfig?: TaskProviderConfigValidator,
): void {
  const registration = ctx.collected.taskProviderRegistration
  if (registration === undefined) return

  const { manifest } = plugin
  const { type, ...entry } = registration
  const before = getTaskProviderDescriptor(type)
  registerContributedTaskProviderType(type, {
    pluginId: manifest.id,
    factory: entry.factory,
    autoProvision: entry.autoProvision,
    provision: entry.provision,
    validateConfig,
    capabilities: entry.capabilities,
    displayName: entry.displayName,
    instanceConfigSchema: entry.instanceConfigSchema,
    contextConfigSchema: entry.contextConfigSchema,
    traits: entry.traits,
  })
  const after = getTaskProviderDescriptor(type)
  if (
    before !== undefined ||
    after?.source === undefined ||
    after.source === 'builtin' ||
    after.source.plugin !== manifest.id
  ) {
    throw new Error(`Task provider type '${type}' could not be registered for plugin '${manifest.id}'`)
  }
}

function commitChatProviderRegistration(plugin: DiscoveredPlugin, ctx: ReturnType<typeof buildPluginContext>): void {
  const registration = ctx.collected.chatProviderRegistration
  if (registration === undefined) return

  const { manifest } = plugin
  const { type, ...entry } = registration
  const before = getChatProviderDescriptor(type)
  registerContributedChatProviderType(type, {
    pluginId: manifest.id,
    factory: entry.factory,
    capabilities: entry.capabilities,
    traits: entry.traits,
    threadCapabilities: entry.threadCapabilities,
    displayName: entry.displayName,
    instanceConfigSchema: entry.instanceConfigSchema,
  })
  const after = getChatProviderDescriptor(type)
  if (
    before !== undefined ||
    after === undefined ||
    after.source === 'builtin' ||
    after.source.plugin !== manifest.id
  ) {
    throw new Error(`Chat provider type '${type}' could not be registered for plugin '${manifest.id}'`)
  }
}

async function activatePluginInstance(
  instance: PluginInstance | null,
  activationContext: ReturnType<typeof buildPluginContext>,
  activationTimeout: ReturnType<typeof buildActivationTimeout>,
): Promise<void> {
  if (instance === null) return
  await Promise.race([
    runWithClosedRegistration(activationContext, (ctx) => instance.activate(ctx)),
    activationTimeout.promise,
  ])
}

function finalizeSuccessfulActivation(
  plugin: DiscoveredPlugin,
  activationContext: ReturnType<typeof buildPluginContext>,
  instance: PluginInstance | null,
  validateConfig?: TaskProviderConfigValidator,
): void {
  const { manifest } = plugin
  const { collected } = activationContext

  commitTaskProviderRegistration(plugin, activationContext, validateConfig)
  commitChatProviderRegistration(plugin, activationContext)
  contributionRegistry.register(manifest.id, collected, manifest)
  if (instance !== null) {
    activeInstances.set(manifest.id, instance)
  }
  pluginRegistry.markActive(manifest.id)
  activationOrder.push(manifest.id)
  recordRuntimeEvent(manifest.id, 'activated')
  log.info({ pluginId: manifest.id }, 'Plugin activated successfully')
}

function closeActivationRegistration(activationContext: ReturnType<typeof buildPluginContext>): void {
  activationContext.closeRegistration()
}

function handleActivationFailure(pluginId: string, msg: string): false {
  log.error({ pluginId, error: msg }, 'Plugin activation failed')
  activeInstances.delete(pluginId)
  contributionRegistry.deregister(pluginId)
  deactivateContributedTaskProviderTypes(pluginId)
  deactivateContributedChatProviderTypes(pluginId)
  pluginRegistry.markError(pluginId, `Activation failed: ${msg}`)
  recordRuntimeEvent(pluginId, 'error', `Activation failed: ${msg}`)
  return false
}

async function activateOne(plugin: DiscoveredPlugin): Promise<boolean> {
  const { manifest, entryPoint } = plugin

  log.info({ pluginId: manifest.id, entryPoint }, 'Activating plugin')

  const importedModule =
    manifest.mcp !== undefined && entryPoint === ''
      ? null
      : await importPluginModule(entryPoint).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err)
          log.error({ pluginId: manifest.id, error: msg }, 'Failed to import plugin entry point')
          pluginRegistry.markError(manifest.id, `Import failed: ${msg}`)
          recordRuntimeEvent(manifest.id, 'error', `Import failed: ${msg}`)
          return null
        })
  if (entryPoint !== '' && importedModule === null) return false

  const activationContext = buildPluginContext(manifest, SYSTEM_CONTEXT_ID)
  const activationTimeout = buildActivationTimeout(manifest.activationTimeoutMs)

  try {
    const validateConfig = resolveProviderConfigValidator(manifest, importedModule?.moduleRecord)
    await activatePluginInstance(importedModule?.instance ?? null, activationContext, activationTimeout)
    if (
      manifest.providerConfigValidator !== undefined &&
      activationContext.collected.taskProviderRegistration === undefined
    ) {
      throw new Error(
        `Plugin '${manifest.id}' declares providerConfigValidator but did not register task provider type '${manifest.contributes.taskProviderTypes[0] ?? 'unknown'}'`,
      )
    }
    finalizeSuccessfulActivation(plugin, activationContext, importedModule?.instance ?? null, validateConfig)
    return true
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return handleActivationFailure(manifest.id, msg)
  } finally {
    closeActivationRegistration(activationContext)
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

export type DeactivateAllPluginsOptions = Readonly<{
  retireContributedProviders?: boolean
}>

const cleanupContributedTaskProviderTypes = (pluginId: string, options: DeactivateAllPluginsOptions): void => {
  if (options.retireContributedProviders === true) {
    deactivateContributedTaskProviderTypes(pluginId)
    return
  }
  unregisterContributedTaskProviderTypes(pluginId)
}

const cleanupContributedChatProviderTypes = (pluginId: string, options: DeactivateAllPluginsOptions): void => {
  if (options.retireContributedProviders === true) {
    deactivateContributedChatProviderTypes(pluginId)
    return
  }
  unregisterContributedChatProviderTypes(pluginId)
}

async function deactivateOne(pluginId: string, options: DeactivateAllPluginsOptions): Promise<void> {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined || entry.state !== 'active') return

  const instance = activeInstances.get(pluginId)

  try {
    if (instance !== undefined && typeof instance.deactivate === 'function') {
      const { ctx } = buildPluginContext(entry.discoveredPlugin.manifest, SYSTEM_CONTEXT_ID, {
        registrationInitiallyOpen: false,
      })
      await Promise.resolve(instance.deactivate(ctx))
    }
    activeInstances.delete(pluginId)
    contributionRegistry.deregister(pluginId)
    cleanupContributedTaskProviderTypes(pluginId, options)
    cleanupContributedChatProviderTypes(pluginId, options)
    removeActivatedPluginId(pluginId)
    pluginRegistry.markDeactivated(pluginId)
    recordRuntimeEvent(pluginId, 'deactivated')
    log.info({ pluginId }, 'Plugin deactivated')
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    log.error({ pluginId, error: msg }, 'Plugin deactivation error (continuing)')
    activeInstances.delete(pluginId)
    contributionRegistry.deregister(pluginId)
    cleanupContributedTaskProviderTypes(pluginId, options)
    cleanupContributedChatProviderTypes(pluginId, options)
    removeActivatedPluginId(pluginId)
    pluginRegistry.markDeactivated(pluginId)
    recordRuntimeEvent(pluginId, 'error', `Deactivation error: ${msg}`)
  }
}

export async function deactivatePluginById(pluginId: string, options: DeactivateAllPluginsOptions = {}): Promise<void> {
  await deactivateOne(pluginId, options)
}

export async function deactivateAllPlugins(options: DeactivateAllPluginsOptions = {}): Promise<void> {
  const toDeactivate = [...activationOrder].reverse()
  if (toDeactivate.length === 0) return

  log.info({ count: toDeactivate.length }, 'Deactivating plugins')

  await toDeactivate.reduce((chain, id) => chain.then(() => deactivateOne(id, options)), Promise.resolve())

  activeInstances.clear()
  activationOrder.length = 0
  log.info('All plugins deactivated')
}

export function getActivatedPluginIds(): string[] {
  return [...activationOrder]
}

export { registerChatProviderFactories } from './chat-provider-factory-registration.js'
export { toPluginImportSpecifier }
