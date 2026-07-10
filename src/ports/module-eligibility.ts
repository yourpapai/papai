// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/** Returns whether a module's contributions should surface in the given chat context. */
export type ModuleEligibilityPredicate = (storageContextId: string) => boolean

/**
 * Registry of module eligibility predicates, populated at the composition root from each module's
 * `isEligibleForContext`. Consulted by the module tool/command/prompt assembly. A module with no
 * registered predicate is eligible everywhere (the default), so this is a no-op until a module opts in.
 *
 * NOTE: keep this file feature-agnostic — the architecture guard scans `src/ports/**` for
 * feature/provider names. Do not reference concrete module or feature names here.
 */
export interface ModuleEligibilityRegistry {
  register(moduleId: string, predicate: ModuleEligibilityPredicate): void
  isEligible(moduleId: string, storageContextId: string): boolean
  clear(): void
}

/** Create an isolated registry (used by tests and, as a singleton, by the runtime). */
export function createModuleEligibilityRegistry(): ModuleEligibilityRegistry {
  const predicates = new Map<string, ModuleEligibilityPredicate>()
  return {
    register: (moduleId, predicate) => {
      predicates.set(moduleId, predicate)
    },
    isEligible: (moduleId, storageContextId) => {
      const predicate = predicates.get(moduleId)
      return predicate === undefined ? true : predicate(storageContextId)
    },
    clear: () => {
      predicates.clear()
    },
  }
}

/** Process-wide singleton: composition registers predicates here; the assembly consults it. */
export const moduleEligibilityRegistry: ModuleEligibilityRegistry = createModuleEligibilityRegistry()
