// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { contributionRegistry } from './contributions.js'
import { pluginRegistry } from './registry.js'
import type { PluginManifest } from './types.js'

function isProviderCoupledManifest(manifest: PluginManifest): boolean {
  if (manifest.permissions.includes('tasks.read') || manifest.permissions.includes('tasks.write')) return true
  if (manifest.permissions.includes('provider.task')) return true
  if (manifest.contributes.taskProviderTypes.length > 0) return true
  if (manifest.requiredTaskCapabilities.length > 0) return true
  if (manifest.providerCapabilities.length > 0) return true
  if ((manifest.providerTraits?.length ?? 0) > 0) return true
  if (manifest.providerConfigSchema.length > 0) return true
  if ((manifest.providerContextConfigSchema?.length ?? 0) > 0) return true
  if (manifest.providerConfigValidator !== undefined) return true
  return false
}

export function pluginUsesTaskProviderFacade(pluginId: string): boolean {
  const contributions = contributionRegistry.getContributions(pluginId)
  if (contributions !== undefined) return isProviderCoupledManifest(contributions.manifest)
  const entry = pluginRegistry.getEntry(pluginId)
  if (entry === undefined) return false
  return isProviderCoupledManifest(entry.discoveredPlugin.manifest)
}

export function filterProviderlessPluginIds(pluginIds: readonly string[]): string[] {
  return pluginIds.filter((pluginId) => !pluginUsesTaskProviderFacade(pluginId))
}
