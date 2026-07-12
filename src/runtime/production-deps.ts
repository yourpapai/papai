// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { announceNewVersion } from '../announcements.js'
import { isS3Configured } from '../attachments/index.js'
import { createStagedDownloader } from '../attachments/staged-download.js'
import { setupBot, type BotDeps } from '../bot.js'
import { resolveChatParticipant } from '../chat/participants/roster.js'
import { createChatProviderFromConfig } from '../chat/registry.js'
import { ChatRouter } from '../chat/router.js'
import { registerCommandMenuIfSupported } from '../chat/startup.js'
import { startSweeper } from '../dashboard-auth/sweeper.js'
import { closeDrizzleDb } from '../db/drizzle.js'
import { closeMigrationDbInstance, initDb } from '../db/index.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../debug/chat-router-runtime.js'
import { routeRequest, startDebugServer, stopDebugServer } from '../debug/server.js'
import { startPollers, stopPollers } from '../deferred-prompts/poller.js'
import { bootstrapInstancesFromEnv } from '../instances/bootstrap.js'
import { warnUnresolvedTaskInstances } from '../instances/health.js'
import { runKaneoLegacyRepair } from '../instances/kaneo-legacy-repair.js'
import { listActivePlatformInstancesSafe } from '../instances/platform-store.js'
import { listTaskInstancesSafe } from '../instances/task-store.js'
import type { PlatformInstance } from '../instances/types.js'
import { logger } from '../logger.js'
import { initializeMessageCache } from '../message-cache/index.js'
import { flushOnShutdown } from '../message-queue/index.js'
import { discoverPlugins } from '../plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from '../plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from '../plugins/registry.js'
import { collectStartupCompatibilityInstances } from '../plugins/startup-compatibility.js'
import { evaluateStartupGuard } from '../plugins/startup-guard.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
  registerMembershipSubscriber,
  runMembershipBackfill,
} from '../providers/membership/index.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import { scheduler } from '../scheduler-instance.js'
import { startScheduler, stopScheduler } from '../scheduler.js'
import { warnIfLegacyDebugToken } from '../startup-helpers.js'
import { missingSystemConfigKeys, seedSystemConfigFromEnv } from '../system-config.js'
import { initUsageRecorder } from '../usage/index.js'
import { toolCapabilityCatalog } from './capability-catalog.js'
import type { PapaiRuntimeDeps, PartialRuntimeDeps } from './types.js'

const log = logger.child({ scope: 'main' })
const INGRESS_ERROR = 'Programmatic ingress is available only when configured'

type ProductionState = {
  activePlatforms: readonly PlatformInstance[]
  stopSweeper: (() => void) | null
}

function startDatabase(): void {
  try {
    initDb()
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
    process.exit(1)
  }
  seedSystemConfigFromEnv()
  const bootstrapResult = bootstrapInstancesFromEnv()
  log.info({ bootstrapResult }, 'instance bootstrap evaluated')
  const missing = missingSystemConfigKeys()
  if (missing.length > 0) {
    log.warn({ missing }, 'system_config is incomplete; the bot will reply "misconfigured" until these keys are set')
  }
  initUsageRecorder()
}

function stopDatabase(): void {
  closeDrizzleDb()
  closeMigrationDbInstance()
}

function configureMembership(router: ChatRouter): void {
  const membershipDeps = {
    ...defaultMembershipDeps,
    resolveUserLabel: (userId: string, groupContextId: string, platformInstanceId: string): Promise<string | null> =>
      router.resolveUserLabel(userId, { contextId: groupContextId, contextType: 'group', platformInstanceId }),
  }
  const ensure = (groupContextId: string, chatUserId: string): ReturnType<typeof ensureWorkspaceMember> =>
    ensureWorkspaceMember(groupContextId, chatUserId, membershipDeps)
  registerMembershipSubscriber({
    ensure,
    markInactive: (groupContextId, chatUserId) => {
      markMemberInactive(groupContextId, chatUserId)
      return Promise.resolve()
    },
  })
  void runMembershipBackfill({ ensure })
    .then((result) => {
      log.info(result, 'Startup membership backfill finished')
    })
    .catch((error: unknown) => {
      log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Startup membership backfill failed')
    })
}

function createProductionRouter(state: ProductionState): ChatRouter {
  const active = listActivePlatformInstancesSafe()
  for (const failure of active.failures) {
    log.warn(failure, 'Skipping unreadable active platform instance during startup')
  }
  const router = new ChatRouter((id, type, config) => createChatProviderFromConfig(id, type, config))
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
  state.activePlatforms = active.instances
  return router
}

function evaluateCompatibility(router: ChatRouter, state: ProductionState): void {
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

async function startExtensions(router: ChatRouter, state: ProductionState): Promise<readonly string[]> {
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
  evaluateCompatibility(router, state)
  const requested = pluginRegistry.getApprovedCompatiblePlugins()
  await activatePlugins(requested)
  const activated = getActivatedPluginIds()
  log.info({ activeCount: activated.length, requestedCount: requested.length }, 'Plugin activation complete')
  if (activated.includes('task-provider-kaneo')) {
    log.info({ kaneoRepairSummary: runKaneoLegacyRepair() }, 'Kaneo legacy repair evaluated')
  }
  warnUnresolvedTaskInstances()
  warnIfLegacyDebugToken()
  return activated
}

function setupProductionBot(router: ChatRouter, adminUserId: string): void {
  log.info(
    {
      adminUserConfigured: Boolean(adminUserId),
      chatProvider: process.env['CHAT_PROVIDER'],
      taskProviderSource: 'context_settings',
      s3Storage: isS3Configured(),
    },
    'Starting papai...',
  )
  const processMessage: BotDeps['processMessage'] = (...args) =>
    import('../llm-orchestrator.js').then((mod) => mod.processMessage(...args))
  const stagedDownloadFn = createStagedDownloader(router)
  const chatParticipantResolver: BotDeps['chatParticipantResolver'] = (contextId, query, limit) =>
    resolveChatParticipant(
      contextId,
      query,
      (userId) => router.resolveUserLabel(userId, { contextId, contextType: 'group' }),
      limit,
    )
  setupBot(router, adminUserId, { processMessage, stagedDownloadFn, chatParticipantResolver })
}

function createApplicationDeps(state: ProductionState): PapaiRuntimeDeps['application'] {
  return {
    initializeStores: initializeMessageCache,
    setupBot: setupProductionBot,
    registerCommandMenu: async (router, adminUserId) => {
      await registerCommandMenuIfSupported(router, adminUserId)
    },
    announceStartup: async (router, adminUserId) => {
      const first = state.activePlatforms[0]
      if (first === undefined) {
        log.warn('Skipping startup announcement: cannot determine current platform instance')
        return
      }
      await announceNewVersion(router, first.id, adminUserId)
    },
    flush: () => flushOnShutdown({ timeoutMs: 5000 }),
  }
}

function createBackgroundDeps(state: ProductionState): PapaiRuntimeDeps['background'] {
  return {
    start: (router) => {
      startScheduler(router)
      startPollers(router, (contextId) => defaultTaskProviderResolver.resolve(contextId))
      scheduler.startAll()
      state.stopSweeper = startSweeper()
    },
    stop: () => {
      stopScheduler()
      scheduler.stopAll()
      stopPollers()
      state.stopSweeper?.()
      state.stopSweeper = null
    },
  }
}

function createDefaultDeps(state: ProductionState): PapaiRuntimeDeps {
  return {
    database: { start: startDatabase, stop: stopDatabase },
    chat: {
      createRouter: () => createProductionRouter(state),
      ingress: {
        dispatch: () => Promise.reject(new Error(INGRESS_ERROR)),
        dispatchInteraction: () => Promise.reject(new Error(INGRESS_ERROR)),
      },
      setRuntime: (router) => {
        setRuntimeChatRouter(router)
        configureMembership(router)
      },
      clearRuntime: clearRuntimeChatRouter,
    },
    extensions: { start: (router) => startExtensions(router, state), stop: deactivateAllPlugins },
    application: createApplicationDeps(state),
    background: createBackgroundDeps(state),
    web: {
      start: (adminUserId) => {
        startDebugServer(adminUserId, { debugEnabled: process.env['DEBUG_SERVER'] === 'true' })
      },
      stop: stopDebugServer,
      route: routeRequest,
    },
    capabilities: toolCapabilityCatalog,
  }
}

export function createProductionRuntimeDeps(overrides: PartialRuntimeDeps = {}): PapaiRuntimeDeps {
  const defaults = createDefaultDeps({ activePlatforms: [], stopSweeper: null })
  return {
    database: { ...defaults.database, ...overrides.database },
    chat: { ...defaults.chat, ...overrides.chat },
    extensions: { ...defaults.extensions, ...overrides.extensions },
    application: { ...defaults.application, ...overrides.application },
    background: { ...defaults.background, ...overrides.background },
    web: { ...defaults.web, ...overrides.web },
    capabilities: { ...defaults.capabilities, ...overrides.capabilities },
  }
}
