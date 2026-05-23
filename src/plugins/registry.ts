// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from '../chat/types.js'
import { getPluginConfig } from '../config.js'
import { logger } from '../logger.js'
import type { TaskCapability } from '../providers/types.js'
import { checkPluginCompatibility } from './compatibility.js'
import {
  getPluginAdminState,
  getPluginContextState,
  isPluginEnabledForContext,
  setPluginContextEnabled,
  upsertPluginAdminState,
  updatePluginAdminStateField,
} from './store.js'
import type { DiscoveredPlugin, PluginState } from './types.js'

const log = logger.child({ scope: 'plugins:registry' })

const VALID_PLUGIN_STATES: ReadonlySet<PluginState> = new Set<PluginState>([
  'discovered',
  'approved',
  'rejected',
  'incompatible',
  'config_missing',
  'active',
  'error',
])

function hasApprovedManifestHash(value: string | null | undefined): boolean {
  return value !== null && value !== undefined && value !== ''
}

function resolveStartupState(state: PluginState, approvedManifestHash: string | null | undefined): PluginState {
  if (state === 'rejected') return 'rejected'
  if (state === 'discovered') return 'discovered'
  if (hasApprovedManifestHash(approvedManifestHash)) return 'approved'
  return 'discovered'
}

function toPluginState(value: string): PluginState {
  for (const state of VALID_PLUGIN_STATES) {
    if (state === value) return state
  }
  log.warn({ value }, 'Unknown plugin state in DB — defaulting to discovered')
  return 'discovered'
}

export { checkPluginCompatibility } from './compatibility.js'

export type PluginContextEligibility =
  | { eligible: true }
  | { eligible: false; reason: 'inactive' | 'disabled' | 'config_missing'; missingKeys?: readonly string[] }

export type PluginRegistryEntry = {
  discoveredPlugin: DiscoveredPlugin
  /** Current effective state (may be in-memory only for runtime states). */
  state: PluginState
  compatibilityReason?: string
}

/** In-memory registry of all known plugins for the current process lifetime. */
export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>()

  /** Register a newly discovered plugin. Updates DB if first time seen or hash changed. */
  registerDiscovered(plugin: DiscoveredPlugin): void {
    const { manifest, manifestHash } = plugin
    const existing = getPluginAdminState(manifest.id)

    if (existing === undefined) {
      upsertPluginAdminState(manifest.id, 'discovered', { lastSeenManifestHash: manifestHash })
      this.entries.set(manifest.id, { discoveredPlugin: plugin, state: 'discovered' })
      log.info({ pluginId: manifest.id }, 'Plugin registered as discovered')
      return
    }

    // If manifest hash changed and plugin was previously approved, revert to discovered
    if (
      existing.approvedManifestHash !== null &&
      existing.approvedManifestHash !== undefined &&
      manifestHash !== existing.approvedManifestHash
    ) {
      updatePluginAdminStateField(manifest.id, {
        state: 'discovered',
        lastSeenManifestHash: manifestHash,
        approvedManifestHash: null,
        approvedBy: null,
        compatibilityReason: 'Manifest changed — re-approval required',
      })
      this.entries.set(manifest.id, {
        discoveredPlugin: plugin,
        state: 'discovered',
        compatibilityReason: 'Manifest changed — re-approval required',
      })
      log.warn({ pluginId: manifest.id }, 'Plugin manifest hash changed — reverted to discovered state')
      return
    }

    // Update last seen hash
    const normalizedState = resolveStartupState(toPluginState(existing.state), existing.approvedManifestHash)
    updatePluginAdminStateField(manifest.id, {
      lastSeenManifestHash: manifestHash,
      state: normalizedState,
      compatibilityReason: normalizedState === 'approved' ? null : (existing.compatibilityReason ?? null),
    })
    this.entries.set(manifest.id, {
      discoveredPlugin: plugin,
      state: normalizedState,
      compatibilityReason: normalizedState === 'approved' ? undefined : (existing.compatibilityReason ?? undefined),
    })
  }

  /** Bot admin approves a plugin for loading. */
  approve(pluginId: string, adminUserId: string, manifestHash: string): boolean {
    const entry = this.entries.get(pluginId)
    if (entry === undefined) {
      log.warn({ pluginId }, 'Attempted to approve unknown plugin')
      return false
    }
    upsertPluginAdminState(pluginId, 'approved', {
      approvedBy: adminUserId,
      approvedManifestHash: manifestHash,
      lastSeenManifestHash: manifestHash,
      compatibilityReason: null,
    })
    entry.state = 'approved'
    entry.compatibilityReason = undefined
    log.info({ pluginId, adminUserId }, 'Plugin approved')
    return true
  }

  /** Bot admin rejects (globally disables) a plugin. */
  reject(pluginId: string): boolean {
    const entry = this.entries.get(pluginId)
    if (entry === undefined) {
      log.warn({ pluginId }, 'Attempted to reject unknown plugin')
      return false
    }
    upsertPluginAdminState(pluginId, 'rejected', {
      approvedBy: null,
      approvedManifestHash: null,
    })
    entry.state = 'rejected'
    log.info({ pluginId }, 'Plugin rejected')
    return true
  }

  /** Evaluate compatibility and update state for approved plugins. */
  evaluateCompatibility(
    pluginId: string,
    taskCapabilities: ReadonlySet<TaskCapability>,
    chatCapabilities: ReadonlySet<ChatCapability>,
  ): void {
    const entry = this.entries.get(pluginId)
    if (entry === undefined || entry.state !== 'approved') return

    const result = checkPluginCompatibility(entry.discoveredPlugin.manifest, taskCapabilities, chatCapabilities)
    if (!result.compatible) {
      entry.state = 'incompatible'
      entry.compatibilityReason = result.reason
      log.warn({ pluginId, reason: result.reason }, 'Plugin marked incompatible')
    }
  }

  /** Mark plugin as active after successful activation. */
  markActive(pluginId: string): void {
    const entry = this.entries.get(pluginId)
    if (entry !== undefined) {
      entry.state = 'active'
    }
    log.info({ pluginId }, 'Plugin marked active')
  }

  /** Mark plugin as error after activation failure. */
  markError(pluginId: string, reason: string): void {
    const entry = this.entries.get(pluginId)
    if (entry !== undefined) {
      entry.state = 'error'
      entry.compatibilityReason = reason
    }
    log.error({ pluginId, reason }, 'Plugin marked as error')
  }

  /** Mark plugin back to approved on clean deactivation. */
  markDeactivated(pluginId: string): void {
    const entry = this.entries.get(pluginId)
    if (entry !== undefined && entry.state === 'active') {
      entry.state = 'approved'
    }
  }

  getEntry(pluginId: string): PluginRegistryEntry | undefined {
    return this.entries.get(pluginId)
  }

  getAllEntries(): PluginRegistryEntry[] {
    return Array.from(this.entries.values())
  }

  clearForTesting(): void {
    this.entries.clear()
  }

  getApprovedCompatiblePlugins(): DiscoveredPlugin[] {
    return Array.from(this.entries.values())
      .filter((e) => e.state === 'approved')
      .map((e) => e.discoveredPlugin)
  }

  getActivePlugins(): DiscoveredPlugin[] {
    return Array.from(this.entries.values())
      .filter((e) => e.state === 'active')
      .map((e) => e.discoveredPlugin)
  }
}

function getMissingRequiredConfigKeys(plugin: DiscoveredPlugin, contextId: string): readonly string[] {
  return plugin.manifest.configRequirements
    .filter((requirement) => requirement.required)
    .filter((requirement) => {
      const value = getPluginConfig(contextId, plugin.manifest.id, requirement.key)
      return value === null || value.trim() === ''
    })
    .map((requirement) => requirement.key)
}

/** Singleton plugin registry for the current process. */
export const pluginRegistry = new PluginRegistry()

export function resetPluginRegistryForTesting(): void {
  pluginRegistry.clearForTesting()
}

/** Enable or disable a plugin for a specific context (user or group). */
export function setPluginEnabledForContext(pluginId: string, contextId: string, enabled: boolean): void {
  setPluginContextEnabled(pluginId, contextId, enabled)
}

/** Check if a plugin is enabled for a specific context. */
export function isPluginActiveForContext(pluginId: string, contextId: string): boolean {
  return getPluginContextEligibility(pluginId, contextId).eligible
}

export function getPluginContextEligibility(pluginId: string, contextId: string): PluginContextEligibility {
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined || entry.state !== 'active') return { eligible: false, reason: 'inactive' }
  const contextState = getPluginContextState(pluginId, contextId)
  const enabled =
    contextState === undefined
      ? entry.discoveredPlugin.manifest.defaultEnabled
      : isPluginEnabledForContext(pluginId, contextId)
  if (!enabled) return { eligible: false, reason: 'disabled' }

  const missingKeys = getMissingRequiredConfigKeys(entry.discoveredPlugin, contextId)
  if (missingKeys.length > 0) return { eligible: false, reason: 'config_missing', missingKeys }

  return { eligible: true }
}

/** Load admin state from DB into the in-memory registry for all known plugins. */
export function syncRegistryFromDb(discoveredPlugins: DiscoveredPlugin[]): void {
  for (const plugin of discoveredPlugins) {
    pluginRegistry.registerDiscovered(plugin)
  }
  log.info({ count: discoveredPlugins.length }, 'Registry synced from DB')
}

/** Get plugins that are active AND enabled for the given context. */
export function getPluginsForContext(contextId: string): DiscoveredPlugin[] {
  return pluginRegistry
    .getActivePlugins()
    .filter((plugin) => getPluginContextEligibility(plugin.manifest.id, contextId).eligible)
}
