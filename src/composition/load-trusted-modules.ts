// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { applyModuleMigrations } from '../db/index.js'
import type { Migration } from '../db/migrate.js'
import { moduleCommandRegistry, modulePromptFragmentRegistry } from '../ports/module-contributions.js'
import { moduleEligibilityRegistry } from '../ports/module-eligibility.js'
import { moduleToolRegistry } from '../ports/module-tools.js'
import type { TrustedModule, TrustedModuleRuntime } from '../ports/module.js'
import { operatorAllowlistPort } from '../ports/operator-allowlist.js'
import { moduleSettingsRegistry } from '../ports/settings-sections.js'
import { toolGateRegistry } from '../ports/tool-gate.js'
import { TRUSTED_MODULES } from './trusted-modules.js'

let activeModules: readonly TrustedModule[] = []

function clearModuleContributions(): void {
  moduleToolRegistry.clear()
  moduleCommandRegistry.clear()
  modulePromptFragmentRegistry.clear()
  moduleSettingsRegistry.clear()
  moduleEligibilityRegistry.clear()
}

function resetModuleRuntime(modules: readonly TrustedModule[]): void {
  for (const mod of modules) mod.resetRuntime?.()
  operatorAllowlistPort.reset()
  toolGateRegistry.clear()
}

/** Remove every active module's process-wide runtime state and contributed surface. */
export function unloadTrustedModules(): void {
  const modules = activeModules
  activeModules = []
  resetModuleRuntime(modules)
  clearModuleContributions()
}

/**
 * Load trusted modules: run every module's migrations first (so any module's `onActivate` can
 * assume all module tables exist), then call each `onActivate` in registry order. `runMigrationsFn`
 * is injectable for tests; production uses the real DB-backed `applyModuleMigrations`.
 */
export async function loadTrustedModules(
  modules: readonly TrustedModule[] = TRUSTED_MODULES,
  runMigrationsFn: (migrations: readonly Migration[]) => void = applyModuleMigrations,
  runtime: TrustedModuleRuntime = {},
): Promise<void> {
  // Modules are process-wide contributions. A new runtime must replace, rather
  // than append to, the previous runtime's registry entries.
  unloadTrustedModules()
  try {
    for (const mod of modules) {
      if (mod.migrations !== undefined && mod.migrations.length > 0) {
        runMigrationsFn(mod.migrations)
      }
    }
    for (const mod of modules) {
      mod.configureRuntime?.(runtime)
      if (mod.tools !== undefined && mod.tools.length > 0) {
        moduleToolRegistry.register(mod.id, mod.tools)
      }
      if (mod.commands !== undefined && mod.commands.length > 0) {
        moduleCommandRegistry.register(mod.id, mod.commands)
      }
      if (mod.promptFragments !== undefined && mod.promptFragments.length > 0) {
        modulePromptFragmentRegistry.register(mod.id, mod.promptFragments)
      }
      if (mod.settingsSections !== undefined && mod.settingsSections.length > 0) {
        moduleSettingsRegistry.register(mod.settingsSections)
      }
      if (mod.isEligibleForContext !== undefined) {
        moduleEligibilityRegistry.register(mod.id, mod.isEligibleForContext)
      }
    }
    await modules.reduce(async (previous, mod) => {
      await previous
      await mod.onActivate?.()
    }, Promise.resolve())
    activeModules = modules
  } catch (error) {
    activeModules = []
    resetModuleRuntime(modules)
    clearModuleContributions()
    throw error
  }
}
