// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ChatRouter } from '../chat/router.js'
import { warnUnresolvedTaskInstances } from '../instances/health.js'
import { runKaneoLegacyRepair } from '../instances/kaneo-legacy-repair.js'
import { listActivePlatformInstancesSafe } from '../instances/platform-store.js'
import { listTaskInstancesSafe } from '../instances/task-store.js'
import type { PlatformInstance } from '../instances/types.js'
import { discoverPlugins } from '../plugins/discovery.js'
import {
  activatePlugins,
  deactivateAllPlugins,
  getActivatedPluginIds,
  type ActivatePluginsOptions,
} from '../plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from '../plugins/registry.js'
import { collectStartupCompatibilityInstances } from '../plugins/startup-compatibility.js'
import { evaluateStartupGuard } from '../plugins/startup-guard.js'
import { warnIfLegacyDebugToken } from '../startup-helpers.js'

type ProductionExtensionLogger = Pick<import('pino').Logger, 'error' | 'fatal' | 'info' | 'warn'>

export type ProductionExtensionState = {
  activePlatforms: readonly PlatformInstance[]
  populateRouterFromInstances: boolean
}

function loadActivePlatforms(
  router: ChatRouter,
  state: ProductionExtensionState,
  log: ProductionExtensionLogger,
): void {
  const active = listActivePlatformInstancesSafe()
  for (const failure of active.failures) {
    log.warn(failure, 'Skipping unreadable active platform instance during startup')
  }
  if (state.populateRouterFromInstances) {
    for (const instance of active.instances) {
      try {
        router.addInstance(instance.id, instance.type, instance.config)
      } catch (error) {
        log.error(
          {
            platformInstanceId: instance.id,
            type: instance.type,
            error: error instanceof Error ? error.message : String(error),
          },
          'Skipping invalid active platform instance during startup',
        )
      }
    }
  }
  state.activePlatforms = active.instances
}

function evaluateCompatibility(
  router: ChatRouter,
  state: ProductionExtensionState,
  log: ProductionExtensionLogger,
): void {
  try {
    const taskInstances = listTaskInstancesSafe()
    for (const failure of taskInstances.failures) {
      log.warn(failure, 'Skipping unreadable task instance during plugin compatibility evaluation')
    }
    const instances = collectStartupCompatibilityInstances(router, taskInstances.instances, state.activePlatforms)
    pluginRegistry.evaluateCompatibilityAcrossInstances(instances)
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Plugin compatibility evaluation skipped',
    )
  }
}

async function compensatePluginStartup(startupFailure: unknown): Promise<never> {
  const cleanup = await deactivateAllPlugins().then(
    () => ({ ok: true as const }),
    (error: unknown) => ({ ok: false as const, error }),
  )
  if (!cleanup.ok) {
    throw new AggregateError([startupFailure, cleanup.error], 'Plugin startup and compensation failed', {
      cause: startupFailure,
    })
  }
  throw startupFailure
}

async function activateAndFinalizePlugins(
  requested: ReturnType<typeof pluginRegistry.getApprovedCompatiblePlugins>,
  log: ProductionExtensionLogger,
  options: ActivatePluginsOptions,
): Promise<readonly string[]> {
  try {
    await activatePlugins(requested, options)
    const activated = getActivatedPluginIds()
    log.info({ activeCount: activated.length, requestedCount: requested.length }, 'Plugin activation complete')
    if (activated.includes('task-provider-kaneo')) {
      log.info({ kaneoRepairSummary: runKaneoLegacyRepair() }, 'Kaneo legacy repair evaluated')
    }
    warnUnresolvedTaskInstances()
    warnIfLegacyDebugToken()
    return activated
  } catch (startupFailure) {
    return compensatePluginStartup(startupFailure)
  }
}

export function startProductionExtensions(
  router: ChatRouter,
  state: ProductionExtensionState,
  log: ProductionExtensionLogger,
  options: ActivatePluginsOptions = {},
): Promise<readonly string[]> {
  loadActivePlatforms(router, state, log)
  const { plugins, errors, directoryMissing } = discoverPlugins('plugins')
  if (errors.length > 0) log.warn({ errors: errors.map((error) => error.reason) }, 'Some plugins failed discovery')
  const guard = evaluateStartupGuard({
    directoryMissing,
    debugServerEnabled: process.env['DEBUG_SERVER'] === 'true',
  })
  if (guard.action === 'exit') {
    log.fatal({ reason: guard.reason }, 'Refusing to start: misconfigured deployment')
    process.exit(1)
  }
  if (guard.action === 'warn') log.warn({ reason: guard.reason }, 'Starting in degraded mode')
  syncRegistryFromDb(plugins)
  evaluateCompatibility(router, state, log)
  return activateAndFinalizePlugins(pluginRegistry.getApprovedCompatiblePlugins(), log, options)
}
