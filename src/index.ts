import { announceNewVersion } from './announcements.js'
import { isS3Configured } from './attachments/index.js'
import { createStagedDownloader } from './attachments/staged-download.js'
import { setupBot } from './bot.js'
import { createChatProvider } from './chat/registry.js'
import { registerCommandMenuIfSupported } from './chat/startup.js'
import { closeDrizzleDb } from './db/drizzle.js'
import { closeMigrationDbInstance, initDb } from './db/index.js'
import { startPollers, stopPollers } from './deferred-prompts/poller.js'
import { logger } from './logger.js'
import { initializeMessageCache } from './message-cache/index.js'
import { flushOnShutdown } from './message-queue/index.js'
import { discoverPlugins } from './plugins/discovery.js'
import { activatePlugins, deactivateAllPlugins } from './plugins/loader.js'
import { pluginRegistry, syncRegistryFromDb } from './plugins/registry.js'
import { buildProviderForUser } from './providers/factory.js'
import { scheduler } from './scheduler-instance.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { addUser } from './users.js'

const log = logger.child({ scope: 'main' })

const REQUIRED_ENV_VARS = ['CHAT_PROVIDER', 'ADMIN_USER_ID', 'TASK_PROVIDER'] as const

const missing = REQUIRED_ENV_VARS.filter((v) => (process.env[v]?.trim() ?? '') === '')
if (missing.length > 0) {
  log.error({ variables: missing }, 'Missing required environment variables')
  process.exit(1)
}

// Validate TASK_PROVIDER value and check provider-specific env vars
const TASK_PROVIDER = process.env['TASK_PROVIDER']!
if (TASK_PROVIDER !== 'kaneo' && TASK_PROVIDER !== 'youtrack') {
  log.error({ TASK_PROVIDER }, 'TASK_PROVIDER must be either "kaneo" or "youtrack"')
  process.exit(1)
}

if (TASK_PROVIDER === 'kaneo') {
  const missingKaneo = ['KANEO_CLIENT_URL'].filter((v) => (process.env[v]?.trim() ?? '') === '')
  if (missingKaneo.length > 0) {
    log.error({ variables: missingKaneo }, 'Missing required Kaneo environment variables')
    process.exit(1)
  }
}

if (TASK_PROVIDER === 'youtrack') {
  const missingYouTrack = ['YOUTRACK_URL'].filter((v) => (process.env[v]?.trim() ?? '') === '')
  if (missingYouTrack.length > 0) {
    log.error({ variables: missingYouTrack }, 'Missing required YouTrack environment variables')
    process.exit(1)
  }
}

log.info('Starting papai...')

try {
  initDb()
} catch (error) {
  log.error({ error: error instanceof Error ? error.message : String(error) }, 'Database migration failed')
  process.exit(1)
}

initializeMessageCache()

const adminUserId = process.env['ADMIN_USER_ID']!
addUser(adminUserId, adminUserId)

const chatProvider = createChatProvider(process.env['CHAT_PROVIDER']!)

log.info(
  {
    adminUserConfigured: Boolean(adminUserId),
    chatProvider: process.env['CHAT_PROVIDER'],
    taskProvider: TASK_PROVIDER,
    s3Storage: isS3Configured(),
  },
  'Starting papai...',
)

await chatProvider.start()

const createStagedDownloadFn = async (
  chat: typeof chatProvider,
): Promise<import('./attachments/types.js').StagedFileDownloadFn | null> => {
  if (chat.name === 'telegram') {
    const { getTelegramFileFetcher } = await import('./chat/telegram/index.js')
    const fetcher = getTelegramFileFetcher()
    if (fetcher !== undefined) {
      return createStagedDownloader({ telegramFetcher: fetcher, mattermostFetcher: () => Promise.resolve(null) })
    }
  } else if (chat.name === 'mattermost') {
    const { getMattermostFileFetcher } = await import('./chat/mattermost/index.js')
    const fetcher = getMattermostFileFetcher()
    if (fetcher !== undefined) {
      return createStagedDownloader({ telegramFetcher: () => Promise.resolve(null), mattermostFetcher: fetcher })
    }
  }
  return null
}

const stagedDownloadFn = await createStagedDownloadFn(chatProvider)

setupBot(chatProvider, adminUserId, {
  processMessage: (...args) => import('./llm-orchestrator.js').then((mod) => mod.processMessage(...args)),
  stagedDownloadFn: stagedDownloadFn ?? undefined,
})

void registerCommandMenuIfSupported(chatProvider, adminUserId)

void announceNewVersion(chatProvider, adminUserId)

startScheduler(chatProvider)

startPollers(chatProvider, (userId) => buildProviderForUser(userId, false))

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
  const adminProvider = buildProviderForUser(adminUserId, false)
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
log.info({ count: toActivate.length }, 'Plugin activation complete')

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
      stopDebugServerFn?.()
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
