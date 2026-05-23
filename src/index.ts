// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { announceNewVersion } from './announcements.js'
import { isS3Configured } from './attachments/index.js'
import { createStagedDownloader } from './attachments/staged-download.js'
import { setupBot, type BotDeps } from './bot.js'
import { getMattermostFileFetcher } from './chat/mattermost/index.js'
import { createChatProvider } from './chat/registry.js'
import { registerCommandMenuIfSupported } from './chat/startup.js'
import { getTelegramFileFetcher } from './chat/telegram/index.js'
import { closeDrizzleDb } from './db/drizzle.js'
import { closeMigrationDbInstance, initDb } from './db/index.js'
import { startPollers, stopPollers } from './deferred-prompts/poller.js'
import { bootstrapInstancesFromEnv } from './instances/bootstrap.js'
import { logger } from './logger.js'
import { initializeMessageCache } from './message-cache/index.js'
import { flushOnShutdown } from './message-queue/index.js'
import { discoverPlugins } from './plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins, getActivatedPluginIds } from './plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from './plugins/registry.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import { scheduler } from './scheduler-instance.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { missingSystemConfigKeys, seedSystemConfigFromEnv } from './system-config.js'
import { initUsageRecorder } from './usage/index.js'
import { addUser } from './users.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID'] as const

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
addUser(adminUserId, adminUserId)

const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)

log.info(
  {
    adminUserConfigured: Boolean(adminUserId),
    chatProvider: process.env['CHAT_PROVIDER'],
    taskProviderSource: 'context_settings',
    s3Storage: isS3Configured(),
  },
  'Starting papai...',
)

const createStagedDownloadFn = (
  chat: typeof chatProvider,
): import('./attachments/types.js').StagedFileDownloadFn | null => {
  if (chat.name === 'telegram') {
    return createStagedDownloader({
      telegramFetcher: (fileId) => {
        const fetcher = getTelegramFileFetcher()
        return fetcher === undefined ? Promise.resolve(null) : fetcher(fileId)
      },
      mattermostFetcher: () => Promise.resolve(null),
    })
  }
  if (chat.name === 'mattermost') {
    return createStagedDownloader({
      telegramFetcher: () => Promise.resolve(null),
      mattermostFetcher: (fileId) => {
        const fetcher = getMattermostFileFetcher()
        return fetcher === undefined ? Promise.resolve(null) : fetcher(fileId)
      },
    })
  }
  return null
}

const processMessage: BotDeps['processMessage'] = (...args) =>
  import('./llm-orchestrator.js').then((mod) => mod.processMessage(...args))

const stagedDownloadFn = createStagedDownloadFn(chatProvider)
const botDeps: BotDeps = stagedDownloadFn === null ? { processMessage } : { processMessage, stagedDownloadFn }

setupBot(chatProvider, adminUserId, botDeps)

await chatProvider.start()

void registerCommandMenuIfSupported(chatProvider, adminUserId)

void announceNewVersion(chatProvider, adminUserId)

startScheduler(chatProvider)

startPollers(chatProvider, (contextId) => defaultTaskProviderResolver.resolve(contextId))

// Start the central scheduler with all cleanup tasks
scheduler.startAll()

// Discover and activate plugins
const pluginDir = 'plugins'
const { plugins: discoveredPlugins, errors: pluginErrors } = discoverPlugins(pluginDir)
if (pluginErrors.length > 0) {
  log.warn({ errors: pluginErrors.map((e) => e.reason) }, 'Some plugins failed discovery')
}
syncRegistryFromDb(discoveredPlugins)
try {
  const adminProvider = defaultTaskProviderResolver.resolve(adminUserId)
  if (adminProvider !== null) {
    for (const plugin of discoveredPlugins) {
      pluginRegistry.evaluateCompatibility(plugin.manifest.id, adminProvider.capabilities, chatProvider.capabilities)
    }
  }
} catch (error) {
  log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Plugin compatibility evaluation skipped')
}
const toActivate = pluginRegistry.getApprovedCompatiblePlugins()
await activatePlugins(toActivate)
log.info(
  { activeCount: getActivatedPluginIds().length, requestedCount: toActivate.length },
  'Plugin activation complete',
)

let stopDebugServerFn: (() => void) | null = null

if (process.env['DEBUG_SERVER'] === 'true') {
  const { startDebugServer, stopDebugServer } = await import('./debug/server.js')
  startDebugServer(adminUserId)
  stopDebugServerFn = stopDebugServer
}

// Graceful shutdown handlers
const shutdown = (signal: string): void => {
  log.info(`${signal} received, starting graceful shutdown...`)
  void flushOnShutdown({ timeoutMs: 5000 })
    .then(async () => {
      await deactivateAllPlugins()
      stopScheduler()
      scheduler.stopAll()
      stopPollers()
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
