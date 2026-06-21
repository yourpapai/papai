// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { announceNewVersion } from './announcements.js'
import { isS3Configured } from './attachments/index.js'
import { createStagedDownloader } from './attachments/staged-download.js'
import { setupBot, type BotDeps } from './bot.js'
import { resolveChatParticipant } from './chat/participants/roster.js'
import { createChatProviderFromConfig } from './chat/registry.js'
import { ChatRouter } from './chat/router.js'
import { registerCommandMenuIfSupported } from './chat/startup.js'
import { startSweeper } from './dashboard-auth/sweeper.js'
import { closeDrizzleDb } from './db/drizzle.js'
import { closeMigrationDbInstance, initDb } from './db/index.js'
import { clearRuntimeChatRouter, setRuntimeChatRouter } from './debug/chat-router-runtime.js'
import { startPollers, stopPollers } from './deferred-prompts/poller.js'
import { bootstrapInstancesFromEnv } from './instances/bootstrap.js'
import { warnUnresolvedTaskInstances } from './instances/health.js'
import { runKaneoLegacyRepair } from './instances/kaneo-legacy-repair.js'
import { listActivePlatformInstancesSafe } from './instances/platform-store.js'
import { listTaskInstancesSafe } from './instances/task-store.js'
import { logger } from './logger.js'
import { initializeMessageCache } from './message-cache/index.js'
import { flushOnShutdown } from './message-queue/index.js'
import { discoverPlugins } from './plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from './plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from './plugins/registry.js'
import { collectStartupCompatibilityInstances } from './plugins/startup-compatibility.js'
import { evaluateStartupGuard } from './plugins/startup-guard.js'
import {
  defaultMembershipDeps,
  ensureWorkspaceMember,
  markMemberInactive,
  registerMembershipSubscriber,
} from './providers/membership/index.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import { scheduler } from './scheduler-instance.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { warnIfLegacyDebugToken } from './startup-helpers.js'
import { missingSystemConfigKeys, seedSystemConfigFromEnv } from './system-config.js'
import { initUsageRecorder } from './usage/index.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['ADMIN_USER_ID'] as const

const getEnvValue = (key: string): string => {
  const value = process.env[key]
  if (value === undefined) return ''
  return value.trim()
}

const missing = REQUIRED_ENV_VARS.filter((v) => getEnvValue(v) === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

log.info('Starting papai...')

try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

seedSystemConfigFromEnv()
const bootstrapResult = bootstrapInstancesFromEnv()
log.info({ bootstrapResult }, 'instance bootstrap evaluated')
const missingSystemKeys = missingSystemConfigKeys()
if (missingSystemKeys.length > 0) {
  log.warn(
    { missing: missingSystemKeys },
    'system_config is incomplete; the bot will reply "misconfigured" until these keys are set',
  )
}

initUsageRecorder()

initializeMessageCache()

const adminUserId = process.env['ADMIN_USER_ID']!

const activePlatformResult = listActivePlatformInstancesSafe()
for (const failure of activePlatformResult.failures) {
  log.warn(failure, 'Skipping unreadable active platform instance during startup')
}
const chatProvider = new ChatRouter((id, type, config) => createChatProviderFromConfig(id, type, config))
for (const instance of activePlatformResult.instances) {
  try {
    chatProvider.addInstance(instance.id, instance.type, instance.config)
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
setRuntimeChatRouter(chatProvider)

const membershipDeps = {
  ...defaultMembershipDeps,
  resolveUserLabel: (userId: string, groupContextId: string, platformInstanceId: string): Promise<string | null> =>
    chatProvider.resolveUserLabel(userId, { contextId: groupContextId, contextType: 'group', platformInstanceId }),
}
registerMembershipSubscriber({
  ensure: (groupContextId, chatUserId) => ensureWorkspaceMember(groupContextId, chatUserId, membershipDeps),
  markInactive: (groupContextId, chatUserId) => {
    markMemberInactive(groupContextId, chatUserId)
    return Promise.resolve()
  },
})

log.info(
  {
    adminUserConfigured: Boolean(adminUserId),
    chatProvider: process.env['CHAT_PROVIDER'],
    taskProviderSource: 'context_settings',
    s3Storage: isS3Configured(),
  },
  'Starting papai...',
)

const createStagedDownloadFn = (): import('./attachments/types.js').StagedFileDownloadFn =>
  createStagedDownloader(chatProvider)

const processMessage: BotDeps['processMessage'] = (...args) =>
  import('./llm-orchestrator.js').then((mod) => mod.processMessage(...args))

const stagedDownloadFn = createStagedDownloadFn()
const chatParticipantResolver: BotDeps['chatParticipantResolver'] = (contextId, query, limit) =>
  resolveChatParticipant(
    contextId,
    query,
    (userId) => chatProvider.resolveUserLabel(userId, { contextId, contextType: 'group' }),
    limit,
  )
const botDeps: BotDeps = { processMessage, stagedDownloadFn, chatParticipantResolver }

// Discover and activate plugins before command registration so contributed commands are registered.
const pluginDir = 'plugins'
const { plugins: discoveredPlugins, errors: pluginErrors, directoryMissing } = discoverPlugins(pluginDir)
if (pluginErrors.length > 0) {
  log.warn({ errors: pluginErrors.map((e) => e.reason) }, 'Some plugins failed discovery')
}
const guardDecision = evaluateStartupGuard({
  directoryMissing,
  debugServerEnabled: process.env['DEBUG_SERVER'] === 'true',
})
if (guardDecision.action === 'exit') {
  log.fatal({ reason: guardDecision.reason }, 'Refusing to start: misconfigured deployment')
  process.exit(1)
}
if (guardDecision.action === 'warn') {
  log.warn({ reason: guardDecision.reason }, 'Starting in degraded mode')
}
syncRegistryFromDb(discoveredPlugins)
try {
  const taskInstanceResult = listTaskInstancesSafe()
  for (const failure of taskInstanceResult.failures) {
    log.warn(failure, 'Skipping unreadable task instance during plugin compatibility evaluation')
  }
  const compatibilityInstances = collectStartupCompatibilityInstances(
    chatProvider,
    taskInstanceResult.instances,
    activePlatformResult.instances,
  )
  pluginRegistry.evaluateCompatibilityAcrossInstances(compatibilityInstances)
} catch (error) {
  log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Plugin compatibility evaluation skipped')
}
const toActivate = pluginRegistry.getApprovedCompatiblePlugins()
await activatePlugins(toActivate)
const activatedPluginIds = getActivatedPluginIds()
log.info({ activeCount: activatedPluginIds.length, requestedCount: toActivate.length }, 'Plugin activation complete')

const kaneoPluginActive = activatedPluginIds.includes('task-provider-kaneo')
if (kaneoPluginActive) {
  const kaneoRepairSummary = runKaneoLegacyRepair()
  log.info({ kaneoRepairSummary }, 'Kaneo legacy repair evaluated')
}

warnUnresolvedTaskInstances()
warnIfLegacyDebugToken()

setupBot(chatProvider, adminUserId, botDeps)

await chatProvider.start()

void registerCommandMenuIfSupported(chatProvider, adminUserId)

const [firstActivePlatformInstance] = activePlatformResult.instances
const announcementPlatformInstanceId =
  firstActivePlatformInstance === undefined ? undefined : firstActivePlatformInstance.id
if (announcementPlatformInstanceId === undefined) {
  log.warn('Skipping startup announcement: cannot determine current platform instance')
} else {
  void announceNewVersion(chatProvider, announcementPlatformInstanceId, adminUserId)
}

startScheduler(chatProvider)

startPollers(chatProvider, (contextId) => defaultTaskProviderResolver.resolve(contextId))

scheduler.startAll()

const stopSweeper = startSweeper()

const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
startDebugServer(adminUserId, { debugEnabled: process.env['DEBUG_SERVER'] === 'true' })
const stopDebugServerFn: (() => void) | null = stopDebugServer

// Graceful shutdown handlers
const shutdown = (signal: string): void => {
  log.info(`${signal} received, starting graceful shutdown...`)
  clearRuntimeChatRouter()
  void flushOnShutdown({ timeoutMs: 5000 })
    .then(async () => {
      await deactivateAllPlugins()
      stopScheduler()
      scheduler.stopAll()
      stopPollers()
      stopSweeper()
      if (stopDebugServerFn !== null) stopDebugServerFn()
      return chatProvider.stop()
    })
    .then(() => {
      closeDrizzleDb()
      closeMigrationDbInstance()
      process.exit(0)
    })
}

process.on('SIGTERM', () => {
  shutdown('SIGTERM')
})
process.on('SIGINT', () => {
  shutdown('SIGINT')
})
