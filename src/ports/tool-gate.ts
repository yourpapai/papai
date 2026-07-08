// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Access gate for a tool. 'operator' tools are restricted by the who-may-use guardrail. */
export type ToolGate = 'operator' | 'default'

/**
 * Maps a namespaced tool name (e.g. `plugin_<id>__<tool>`) to its gate.
 *
 * Populated at tool-set assembly from each tool's declared gate and consulted by the
 * who-may-use filter, so core enforces operator-gating without ever enumerating tool names.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete plugin or tool names here.
 */
export interface ToolGateRegistry {
  setGate(toolName: string, gate: ToolGate): void
  getGate(toolName: string): ToolGate
  isOperatorGated(toolName: string): boolean
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createToolGateRegistry(): ToolGateRegistry {
  const gates = new Map<string, ToolGate>()
  return {
    setGate: (toolName, gate) => {
      gates.set(toolName, gate)
    },
    getGate: (toolName) => gates.get(toolName) ?? 'default',
    isOperatorGated: (toolName) => (gates.get(toolName) ?? 'default') === 'operator',
  }
}

/**
 * Process-wide singleton. Tool names are globally unique (plugin-id namespaced), and a gate
 * is static per tool, so a shared registry is safe and stable across contexts.
 */
export const toolGateRegistry: ToolGateRegistry = createToolGateRegistry()
