// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { listContextSettings } from '../instances/context-store.js'
import { getContextStatesForPlugin } from './store.js'
import type { PluginManifest } from './types.js'

export const getScheduledJobContextIds = (pluginId: string, manifest: PluginManifest): string[] => {
  const explicitStates = getContextStatesForPlugin(pluginId)
  if (!manifest.defaultEnabled) {
    return explicitStates.filter((row) => row.enabled).map((row) => row.contextId)
  }

  const explicitDisabled = new Set(explicitStates.filter((row) => !row.enabled).map((row) => row.contextId))
  const explicitEnabled = explicitStates.filter((row) => row.enabled).map((row) => row.contextId)
  const configuredDefaults = listContextSettings()
    // A null task instance means the row was only seeded for platform routing/visibility
    // (pre-/config); such contexts are not "configured" and must not run default jobs.
    .filter((settings) => settings.taskInstanceId !== null)
    .map((settings) => settings.contextId)
    .filter((contextId) => !explicitDisabled.has(contextId))

  return [...new Set([...configuredDefaults, ...explicitEnabled])]
}
