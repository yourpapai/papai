// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'

import { logger } from '../logger.js'
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
import { moduleToolRegistry, type ModuleToolRuntimeContext } from '../ports/module-tools.js'
import { toolGateRegistry } from '../ports/tool-gate.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

const log = logger.child({ scope: 'tools:module' })

const sanitizeModuleId = (moduleId: string): string => moduleId.replace(/-/gu, '_')

/** Namespace a module tool name: `module_<sanitized-id>__<tool>` (parallel to plugin tools). */
export const namespacedModuleToolName = (moduleId: string, toolName: string): string =>
  `module_${sanitizeModuleId(moduleId)}__${toolName}`

/**
 * Assemble the tools contributed by trusted modules into a `ToolSet`, namespaced and wrapped like
 * plugin tools. Records each tool's gate into the ToolGatePort so operator-gating works via the
 * existing who-may-use filter. Names colliding with an already-assembled tool are skipped.
 */
export function buildModuleToolSet(existingToolNames: ReadonlySet<string>, runtime: ModuleToolRuntimeContext): ToolSet {
  const out: ToolSet = {}
  const used = new Set(existingToolNames)
  for (const { moduleId, tool: moduleTool } of moduleToolRegistry.list()) {
    if (!moduleEligibilityRegistry.isEligible(moduleId, runtime.storageContextId)) continue
    const name = namespacedModuleToolName(moduleId, moduleTool.name)
    if (used.has(name)) {
      log.warn({ moduleId, tool: moduleTool.name, name }, 'Module tool name collision; skipping')
      continue
    }
    used.add(name)
    toolGateRegistry.setGate(name, moduleTool.gate ?? 'default')
    const wrapped = wrapToolExecution((input, options) => moduleTool.execute(input, runtime, options), name)
    out[name] = tool({ description: moduleTool.description, inputSchema: moduleTool.inputSchema, execute: wrapped })
  }
  return out
}
