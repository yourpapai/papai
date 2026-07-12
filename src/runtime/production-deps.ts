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
import { closeDrizzleDb } from '../db/drizzle.js'
import { closeMigrationDbInstance, initDb } from '../db/index.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from '../debug/chat-router-runtime.js'
import { routeRequest, startDebugServer, stopDebugServer } from '../debug/server.js'
import { bootstrapInstancesFromEnv } from '../instances/bootstrap.js'
import { logger } from '../logger.js'
import { cancelAndDrainPendingMemoryCaptures } from '../long-term-memory/capture-debounce.js'
import { initializeMessageCache } from '../message-cache/index.js'
import { flushOnShutdown } from '../message-queue/index.js'
import { deactivateAllPlugins } from '../plugins/loader.js'
import type { ProviderRuntimeDeps } from '../plugins/provider-runtime.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
  registerMembershipSubscriber,
  runMembershipBackfill,
} from '../providers/membership/index.js'
import { missingSystemConfigKeys, seedSystemConfigFromEnv } from '../system-config.js'
import { initUsageRecorder } from '../usage/index.js'
import { toolCapabilityCatalog } from './capability-catalog.js'
import type { ProductionBackgroundHandle } from './production-background.js'
import { startProductionExtensions, type ProductionExtensionState } from './production-extensions.js'
import type { PapaiRuntimeDeps, PartialRuntimeDeps } from './types.js'

const log = logger.child({ scope: 'main' })
const INGRESS_ERROR = 'Programmatic ingress is available only when configured'

type ProductionState = ProductionExtensionState & {
  background: ProductionBackgroundHandle | null
  disposeMembershipSubscriber: (() => void) | null
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
  const stop = async (): Promise<void> => {
    const background = state.background
    state.background = null
    await background?.stop()
  }
  return {
    async start(router): Promise<void> {
      if (state.background !== null) return
      const { startProductionBackground } = await import('./production-background.js')
      state.background = await startProductionBackground(router)
    },
    stop,
  }
}

export type ProductionRuntimeOptions = Readonly<{ pluginProviderRuntimeDeps?: ProviderRuntimeDeps }>

function createDefaultDeps(state: ProductionState, options: ProductionRuntimeOptions): PapaiRuntimeDeps {
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
    extensions: {
      start: (router) =>
        startProductionExtensions(router, state, log, {
          providerRuntimeDeps: options.pluginProviderRuntimeDeps,
        }),
      stop: deactivateAllPlugins,
    },
    application: createApplicationDeps(state),
    background: createBackgroundDeps(state),
    web: {
      start: (adminUserId) => {
        startDebugServer(adminUserId, {
          debugEnabled: process.env['DEBUG_SERVER'] === 'true',
          pluginProviderRuntimeDeps: options.pluginProviderRuntimeDeps,
        })
      },
      stop: stopDebugServer,
      route: (request) =>
        routeRequest(request, {
          debugEnabled: process.env['DEBUG_SERVER'] === 'true',
          pluginProviderRuntimeDeps: options.pluginProviderRuntimeDeps,
        }),
    },
    capabilities: toolCapabilityCatalog,
  }
}

export function createProductionRuntimeDeps(
  overrides: PartialRuntimeDeps = {},
  options: ProductionRuntimeOptions = {},
): PapaiRuntimeDeps {
  const defaults = createDefaultDeps(
    {
      activePlatforms: [],
      background: null,
      disposeMembershipSubscriber: null,
      populateRouterFromInstances: overrides.chat?.createRouter === undefined,
    },
    options,
  )
  const application = { ...defaults.application, ...overrides.application }
  const flushApplication = application.flush
  return {
    database: { ...defaults.database, ...overrides.database },
    chat: { ...defaults.chat, ...overrides.chat },
    extensions: { ...defaults.extensions, ...overrides.extensions },
    application: {
      ...application,
      async flush(): Promise<void> {
        await cancelAndDrainPendingMemoryCaptures()
        await flushApplication()
      },
    },
    background: { ...defaults.background, ...overrides.background },
    web: { ...defaults.web, ...overrides.web },
    capabilities:
      overrides.capabilities === undefined
        ? defaults.capabilities
        : { ...defaults.capabilities, ...overrides.capabilities },
  }
}
