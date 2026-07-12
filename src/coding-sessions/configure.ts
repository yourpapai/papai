// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { discoverPlugins } from '../plugins/discovery.js'
import { pluginRegistry, setPluginEnabledForContext } from '../plugins/registry.js'
import { setPluginAdminConfig } from '../plugins/store.js'
import type { DiscoveredPlugin } from '../plugins/types.js'

const CURRENT_IMPLEMENTATION_ID = 'acp'
const START_CAPABILITY_ID = 'coding-session.start'
const MAGI_BASE_URL_KEY = 'magi_base_url'
const MAGI_TOKEN_KEY = 'magi_token'

export type CodingSessionCapabilityConfig = Readonly<{
  pluginDirectory: string
  contextId: string
  magiBaseUrl: string
  magiToken: string
  updatedBy: string
}>

export type ConfiguredCodingSessionCapability = Readonly<{
  capabilityId: typeof START_CAPABILITY_ID
}>

function unavailableImplementation(message: string): Error {
  return new Error(`Coding-session capability implementation is unavailable: ${message}`)
}

function discoverCurrentImplementation(pluginDirectory: string): DiscoveredPlugin {
  const result = discoverPlugins(pluginDirectory)
  if (result.directoryMissing) throw unavailableImplementation(`directory '${pluginDirectory}' does not exist`)
  const implementation = result.plugins.find(({ manifest }) => manifest.id === CURRENT_IMPLEMENTATION_ID)
  if (implementation !== undefined) return implementation
  const detail = result.errors.map(({ directoryName, reason }) => `${directoryName}: ${reason}`).join('; ')
  throw unavailableImplementation(detail === '' ? `none was found in '${pluginDirectory}'` : detail)
}

function ensureCurrentImplementation(pluginDirectory: string, updatedBy: string): void {
  let entry = pluginRegistry.getEntry(CURRENT_IMPLEMENTATION_ID)
  if (entry === undefined) {
    pluginRegistry.registerDiscovered(discoverCurrentImplementation(pluginDirectory))
    entry = pluginRegistry.getEntry(CURRENT_IMPLEMENTATION_ID)
  }
  if (entry === undefined) throw unavailableImplementation('registration did not create a registry entry')
  if (entry.state === 'active' || entry.state === 'approved') return
  if (entry.state === 'rejected') throw unavailableImplementation('explicitly rejected')
  if (entry.state !== 'discovered') throw unavailableImplementation(`current state is '${entry.state}'`)
  const approved = pluginRegistry.approve(CURRENT_IMPLEMENTATION_ID, updatedBy, entry.discoveredPlugin.manifestHash)
  if (!approved) throw unavailableImplementation('registration could not be approved')
}

export function configureCodingSessionCapability(
  config: CodingSessionCapabilityConfig,
): ConfiguredCodingSessionCapability {
  ensureCurrentImplementation(config.pluginDirectory, config.updatedBy)
  setPluginAdminConfig(CURRENT_IMPLEMENTATION_ID, MAGI_BASE_URL_KEY, config.magiBaseUrl, config.updatedBy)
  setPluginAdminConfig(CURRENT_IMPLEMENTATION_ID, MAGI_TOKEN_KEY, config.magiToken, config.updatedBy)
  setPluginEnabledForContext(CURRENT_IMPLEMENTATION_ID, config.contextId, true)
  return { capabilityId: START_CAPABILITY_ID }
}
