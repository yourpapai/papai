// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { PluginContextEligibility } from './registry.js'

export function formatPluginEligibilityMessage(pluginId: string, eligibility: PluginContextEligibility): string {
  if (eligibility.eligible) return `Plugin \`${pluginId}\` is available.`
  if (eligibility.reason === 'inactive') return `Plugin \`${pluginId}\` is not active.`
  if (eligibility.reason === 'disabled') return `Plugin \`${pluginId}\` is disabled for this context.`
  if (eligibility.reason === 'config_missing') {
    return `Plugin \`${pluginId}\` is missing required configuration: ${eligibility.missingKeys.join(', ')}.`
  }
  if (eligibility.reason === 'capability_missing') {
    return `Plugin \`${pluginId}\` is missing required capabilities: ${eligibility.missingCapabilities.join(', ')}.`
  }
  return `Plugin \`${pluginId}\` is not available.`
}
