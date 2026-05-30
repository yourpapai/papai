// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix } from '../cache.js'
import { logger } from '../logger.js'
import { checkPluginCompatibility } from './compatibility.js'
import {
  NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON,
  normalizeCompatibilityInstances,
  type PluginCompatibilityInstance,
} from './registry-compatibility.js'
import { getPluginContextEligibilityForEntry, type PluginContextEligibility } from './registry-context-eligibility.js'
import {
  getPluginAdminState,
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

function toOptionalReason(value: string | null | undefined): string | undefined {
  if (value === null) return undefined
  return value
}

export { checkPluginCompatibility } from './compatibility.js'
export type { PluginContextEligibility } from './registry-context-eligibility.js'

export type PluginRegistryEntry = {
  discoveredPlugin: DiscoveredPlugin
  state: PluginState
  compatibilityReason: string | undefined
}

export type { PluginCompatibilityInstance } from './registry-compatibility.js'

export class PluginRegistry {
  private readonly entries = new Map<string, PluginRegistryEntry>()

  registerDiscovered(plugin: DiscoveredPlugin): void {
    const { manifest, manifestHash } = plugin
    const existing = getPluginAdminState(manifest.id)

    if (existing === undefined) {
      upsertPluginAdminState(manifest.id, 'discovered', { lastSeenManifestHash: manifestHash })
      this.entries.set(manifest.id, { discoveredPlugin: plugin, state: 'discovered', compatibilityReason: undefined })
      log.info({ pluginId: manifest.id }, 'Plugin registered as discovered')
      return
    }

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

    const normalizedState = resolveStartupState(toPluginState(existing.state), existing.approvedManifestHash)
    const compatibilityReason =
      normalizedState === 'approved' ? undefined : toOptionalReason(existing.compatibilityReason)
    updatePluginAdminStateField(manifest.id, {
      lastSeenManifestHash: manifestHash,
      state: normalizedState,
      compatibilityReason: normalizedState === 'approved' ? null : existing.compatibilityReason,
    })
    this.entries.set(manifest.id, {
      discoveredPlugin: plugin,
      state: normalizedState,
      compatibilityReason,
    })
  }

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

  evaluateCompatibilityAcrossInstances(instances: readonly PluginCompatibilityInstance[]): void {
    const candidates = normalizeCompatibilityInstances(instances)
    for (const [pluginId, entry] of this.entries.entries()) {
      if (entry.state !== 'approved') continue
      const compatible = candidates.some((candidate) => {
        const result = checkPluginCompatibility(
          entry.discoveredPlugin.manifest,
          candidate.taskCapabilities,
          candidate.chatCapabilities,
        )
        return result.compatible
      })
      if (compatible) {
        entry.compatibilityReason = undefined
        continue
      }
      entry.state = 'incompatible'
      entry.compatibilityReason = NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON
      log.warn({ pluginId, reason: NO_ACTIVE_INSTANCE_COMPATIBILITY_REASON }, 'Plugin marked incompatible')
    }
  }

  markActive(pluginId: string): void {
    const entry = this.entries.get(pluginId)
    if (entry !== undefined) {
      entry.state = 'active'
    }
    log.info({ pluginId }, 'Plugin marked active')
  }

  markError(pluginId: string, reason: string): void {
    const entry = this.entries.get(pluginId)
    if (entry !== undefined) {
      entry.state = 'error'
      entry.compatibilityReason = reason
    }
    log.error({ pluginId, reason }, 'Plugin marked as error')
  }

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

export const pluginRegistry = new PluginRegistry()

export function resetPluginRegistryForTesting(): void {
  pluginRegistry.clearForTesting()
}

export function setPluginEnabledForContext(pluginId: string, contextId: string, enabled: boolean): void {
  setPluginContextEnabled(pluginId, contextId, enabled)
  clearCachedToolsByPrefix(contextId)
}

export function isPluginActiveForContext(pluginId: string, contextId: string): boolean {
  return getPluginContextEligibility(pluginId, contextId).eligible
}

export function getPluginContextEligibility(pluginId: string, contextId: string): PluginContextEligibility {
  return getPluginContextEligibilityForEntry(pluginRegistry.getEntry(pluginId), pluginId, contextId)
}

export function syncRegistryFromDb(discoveredPlugins: DiscoveredPlugin[]): void {
  for (const plugin of discoveredPlugins) {
    pluginRegistry.registerDiscovered(plugin)
  }
  log.info({ count: discoveredPlugins.length }, 'Registry synced from DB')
}

export function getPluginsForContext(contextId: string): DiscoveredPlugin[] {
  return pluginRegistry
    .getActivePlugins()
    .filter((plugin) => getPluginContextEligibility(plugin.manifest.id, contextId).eligible)
}
