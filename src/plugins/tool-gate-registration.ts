// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { toolGateRegistry, type ToolGateRegistry } from '../ports/tool-gate.js'
import { namespacedToolName } from './contribution-names.js'
import type { PluginTool } from './runtime-types.js'

/**
 * Record each plugin tool's gate into the ToolGatePort under its namespaced name, so the
 * orchestrator's who-may-use filter can enforce operator-gating without knowing tool names.
 */
export function registerToolGates(
  pluginId: string,
  tools: readonly PluginTool[],
  registry: ToolGateRegistry = toolGateRegistry,
): void {
  for (const t of tools) {
    registry.setGate(namespacedToolName(pluginId, t.name), t.gate ?? 'default')
  }
}
