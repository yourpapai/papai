// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'
import type { z } from 'zod'

/** Per-call context handed to a module tool's execute. Trusted modules build their own
 * collaborators (httpFetch/config/storage) at load and close over them in tool factories,
 * so only the per-call varying identity is passed here. */
export type ModuleToolRuntimeContext = {
  storageContextId: string
  chatUserId: string
}

/** A tool contributed by a trusted module. Unlike a sandboxed plugin tool it uses a Zod schema
 * directly and is not permission-gated (a module is trusted). `gate: 'operator'` restricts it
 * via the who-may-use filter through the ToolGatePort, exactly like plugin tools. */
export type ModuleTool = {
  name: string
  description: string
  inputSchema: z.ZodType
  gate?: 'operator'
  execute: (input: unknown, runtimeContext: ModuleToolRuntimeContext, options: ToolExecutionOptions) => Promise<unknown>
}

/** Process-wide registry of tools contributed by trusted modules, populated at the composition
 * root from each module's `tools`. Read by `buildModuleToolSet` at tool assembly.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or tool names here. */
export interface ModuleToolRegistry {
  register(moduleId: string, tools: readonly ModuleTool[]): void
  list(): readonly { moduleId: string; tool: ModuleTool }[]
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createModuleToolRegistry(): ModuleToolRegistry {
  const entries: { moduleId: string; tool: ModuleTool }[] = []
  return {
    register: (moduleId, tools) => {
      for (const tool of tools) entries.push({ moduleId, tool })
    },
    list: () => entries,
    clear: () => {
      entries.length = 0
    },
  }
}

/** Process-wide singleton: composition registers module tools here; `src/tools` reads them. */
export const moduleToolRegistry: ModuleToolRegistry = createModuleToolRegistry()
