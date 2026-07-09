// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Migration } from '../db/migrate.js'
import type { ModuleCommand, ModulePromptFragment } from './module-contributions.js'
import type { ModuleTool } from './module-tools.js'

/**
 * A privileged, in-repo **Trusted Module** (Tier 1). Unlike a sandboxed plugin, a module may
 * own DB tables (via `migrations`) and bind directly to ports. Modules are wired once at the
 * composition root (`src/composition/`), never by the kernel.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard test scans `src/ports/**`
 * for feature/provider names. Do not reference concrete module or feature names here.
 */
export interface TrustedModule {
  /** Stable module id (feature-agnostic contract; the value lives in the module, not here). */
  readonly id: string
  /**
   * Migrations this module owns. Run through the shared `runMigrations` mechanism at load.
   * Ids must be numeric-prefixed (see `src/db/migrate.ts`) and must not collide with other
   * modules' or core's migration ids in the shared `migrations` bookkeeping table.
   */
  readonly migrations?: readonly Migration[]
  /** LLM tools this module contributes (assembled by buildModuleToolSet, namespaced module_<id>__<tool>). */
  readonly tools?: readonly ModuleTool[]
  /** Chat commands this module contributes (registered by registerModuleCommands, namespaced module_<id>_<command>). */
  readonly commands?: readonly ModuleCommand[]
  /** System-prompt fragments this module contributes (assembled by buildModulePromptSection). */
  readonly promptFragments?: readonly ModulePromptFragment[]
  /** Called once after all modules' migrations have run. Registers resolvers/adapters into ports. */
  onActivate?(): void | Promise<void>
}
