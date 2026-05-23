// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatCapability } from '../chat/types.js'
import type { TaskCapability } from '../providers/types.js'
import type { PluginManifest } from './types.js'
import { PLUGIN_API_VERSION } from './types.js'

export type CompatibilityResult = { compatible: true } | { compatible: false; reason: string }

/** Check whether a plugin's requirements are met by the current providers. */
export function checkPluginCompatibility(
  manifest: PluginManifest,
  taskCapabilities: ReadonlySet<TaskCapability>,
  chatCapabilities: ReadonlySet<ChatCapability>,
): CompatibilityResult {
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    return {
      compatible: false,
      reason: `Unsupported apiVersion ${String(manifest.apiVersion)}; expected ${String(PLUGIN_API_VERSION)}`,
    }
  }

  for (const cap of manifest.requiredTaskCapabilities) {
    if (!taskCapabilities.has(cap)) {
      return { compatible: false, reason: `Required task capability missing: ${cap}` }
    }
  }

  for (const cap of manifest.requiredChatCapabilities) {
    if (!chatCapabilities.has(cap)) {
      return { compatible: false, reason: `Required chat capability missing: ${cap}` }
    }
  }

  return { compatible: true }
}
