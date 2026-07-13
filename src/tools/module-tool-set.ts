// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool, type ToolSet } from 'ai'

import { logger } from '../logger.js'
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
import { moduleToolRegistry, namespacedModuleToolName, type ModuleToolRuntimeContext } from '../ports/module-tools.js'
import { toolGateRegistry } from '../ports/tool-gate.js'
import { toolCapabilityCatalog, type ToolCapabilityCatalog } from '../runtime/capability-catalog.js'
import { wrapToolExecution } from './wrap-tool-execution.js'

const log = logger.child({ scope: 'tools:module' })

export { namespacedModuleToolName } from '../ports/module-tools.js'

/**
 * Assemble the tools contributed by trusted modules into a `ToolSet`, namespaced and wrapped like
 * plugin tools. Records each tool's gate into the ToolGatePort so operator-gating works via the
 * existing who-may-use filter. Names colliding with an already-assembled tool are skipped.
 */
export function buildModuleToolSet(
  existingToolNames: ReadonlySet<string>,
  runtime: ModuleToolRuntimeContext,
  capabilityCatalog: ToolCapabilityCatalog = toolCapabilityCatalog,
): ToolSet {
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
    const wrapped = wrapToolExecution((input, options) => moduleTool.execute(input, runtime, options), name)
    const legacyName = moduleTool.legacyWireName
    const registersLegacyName = legacyName !== undefined && !used.has(legacyName)
    if (registersLegacyName) {
      used.add(legacyName)
      out[legacyName] = tool({
        description: moduleTool.description,
        inputSchema: moduleTool.inputSchema,
        execute: wrapped,
      })
    }
    if (moduleTool.capabilityId !== undefined)
      capabilityCatalog.register(moduleTool.capabilityId, registersLegacyName ? legacyName : name)
    toolGateRegistry.setGate(name, moduleTool.gate ?? 'default')
    if (registersLegacyName) toolGateRegistry.setGate(legacyName, moduleTool.gate ?? 'default')
    out[name] = tool({ description: moduleTool.description, inputSchema: moduleTool.inputSchema, execute: wrapped })
  }
  return out
}
