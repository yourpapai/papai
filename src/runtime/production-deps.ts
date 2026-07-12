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
import { bootstrapInstancesFromEnv } from '../instances/bootstrap.js'
import { logger } from '../logger.js'
import { initializeMessageCache } from '../message-cache/index.js'
import { flushOnShutdown } from '../message-queue/index.js'
import { deactivateAllPlugins } from '../plugins/loader.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
  registerMembershipSubscriber,
  runMembershipBackfill,
} from '../providers/membership/index.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import { missingSystemConfigKeys, seedSystemConfigFromEnv } from '../system-config.js'
import { initUsageRecorder } from '../usage/index.js'
import { toolCapabilityCatalog } from './capability-catalog.js'
import { startProductionExtensions, type ProductionExtensionState } from './production-extensions.js'
import type { PapaiRuntimeDeps, PartialRuntimeDeps } from './types.js'

const log = logger.child({ scope: 'main' })
const INGRESS_ERROR = 'Programmatic ingress is available only when configured'

type ProductionState = ProductionExtensionState & {
  backgroundModules: ProductionBackgroundModules | null
  disposeMembershipSubscriber: (() => void) | null
  stopSweeper: (() => void) | null
}

type ProductionBackgroundModules = Readonly<{
  pollers: typeof import('../deferred-prompts/poller.js')
  recurring: typeof import('../scheduler.js')
  schedulerInstance: typeof import('../scheduler-instance.js')
}>

async function loadProductionBackgroundModules(): Promise<ProductionBackgroundModules> {
  const schedulerInstance = await import('../scheduler-instance.js')
  const recurring = await import('../scheduler.js')
  const pollers = await import('../deferred-prompts/poller.js')
  return { schedulerInstance, recurring, pollers }
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

function configureMembership(router: ChatRouter, state: ProductionState): void {
  const membershipDeps = {
    ...defaultMembershipDeps,
    resolveUserLabel: (userId: string, groupContextId: string, platformInstanceId: string): Promise<string | null> =>
      router.resolveUserLabel(userId, { contextId: groupContextId, contextType: 'group', platformInstanceId }),
  }
  const ensure = (groupContextId: string, chatUserId: string): ReturnType<typeof ensureWorkspaceMember> =>
    ensureWorkspaceMember(groupContextId, chatUserId, membershipDeps)
  state.disposeMembershipSubscriber?.()
  state.disposeMembershipSubscriber = null
  state.disposeMembershipSubscriber = registerMembershipSubscriber({
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

function clearProductionChatRuntime(state: ProductionState): void {
  try {
    clearRuntimeChatRouter()
  } finally {
    state.disposeMembershipSubscriber?.()
    state.disposeMembershipSubscriber = null
  }
}

function createProductionRouter(): ChatRouter {
  return new ChatRouter((id, type, config) => createChatProviderFromConfig(id, type, config))
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
  const stop = (): void => {
    const modules = state.backgroundModules
    if (modules !== null) {
      modules.recurring.stopScheduler()
      modules.schedulerInstance.scheduler.stopAll()
      modules.pollers.stopPollers()
      modules.schedulerInstance.unregisterDefaultSchedulerTasks()
      state.backgroundModules = null
    }
    state.stopSweeper?.()
    state.stopSweeper = null
  }
  return {
    async start(router): Promise<void> {
      if (state.backgroundModules !== null) return
      const modules = await loadProductionBackgroundModules()
      state.backgroundModules = modules
      try {
        modules.schedulerInstance.registerDefaultSchedulerTasks()
        modules.recurring.startScheduler(router)
        modules.pollers.startPollers(router, (contextId) => defaultTaskProviderResolver.resolve(contextId))
        modules.schedulerInstance.scheduler.startAll()
        state.stopSweeper = startSweeper()
      } catch (error) {
        stop()
        throw error
      }
    },
    stop,
  }
}

function createDefaultDeps(state: ProductionState): PapaiRuntimeDeps {
  return {
    database: { start: startDatabase, stop: stopDatabase },
    chat: {
      createRouter: createProductionRouter,
      ingress: {
        dispatch: () => Promise.reject(new Error(INGRESS_ERROR)),
        dispatchInteraction: () => Promise.reject(new Error(INGRESS_ERROR)),
      },
      setRuntime: (router) => {
        setRuntimeChatRouter(router)
        configureMembership(router, state)
      },
      clearRuntime: () => {
        clearProductionChatRuntime(state)
      },
    },
    extensions: { start: (router) => startProductionExtensions(router, state, log), stop: deactivateAllPlugins },
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
  const defaults = createDefaultDeps({
    activePlatforms: [],
    backgroundModules: null,
    disposeMembershipSubscriber: null,
    populateRouterFromInstances: overrides.chat?.createRouter === undefined,
    stopSweeper: null,
  })
  return {
    database: { ...defaults.database, ...overrides.database },
    chat: { ...defaults.chat, ...overrides.chat },
    extensions: { ...defaults.extensions, ...overrides.extensions },
    application: { ...defaults.application, ...overrides.application },
    background: { ...defaults.background, ...overrides.background },
    web: { ...defaults.web, ...overrides.web },
    capabilities:
      overrides.capabilities === undefined
        ? defaults.capabilities
        : { ...defaults.capabilities, ...overrides.capabilities },
  }
}
