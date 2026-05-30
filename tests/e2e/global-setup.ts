// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Global E2E test setup - shared across all test files
 *
 * This module ensures Docker containers start only once for all E2E tests,
 * eliminating the overhead of restarting containers for each test file.
 */

import { provisionAndConfigure } from '../../plugins/task-provider-kaneo/provision.js'
import { logger } from '../../src/logger.js'
import { startKaneoServer, stopKaneoServer } from './docker-lifecycle.js'

const log = logger.child({ scope: 'e2e:global-setup' })
const DEFAULT_MAX_SERVER_ATTEMPTS = 60

export type E2EConfig = {
  baseUrl: string
  apiKey: string
  workspaceId: string
}

let e2eConfig: E2EConfig | undefined
let setupPromise: Promise<E2EConfig> | undefined

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function waitForServer(baseUrl: string, maxAttempts: number): Promise<void> {
  const healthUrl = `${baseUrl}/api/health`
  log.info({ healthUrl }, 'Waiting for Kaneo server to be healthy')

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(healthUrl, { method: 'GET' })
      if (response.ok) {
        log.info({ attempts: attempt }, 'Kaneo server is healthy')
        return
      }
    } catch {
      // Server not ready yet
    }

    if (attempt < maxAttempts) {
      log.debug({ attempt, maxAttempts }, 'Server not ready, waiting...')
      await delay(1000)
    }
  }

  throw new Error(`Kaneo server failed to become healthy after ${maxAttempts} attempts`)
}

function resolveBaseUrl(): string {
  const e2eUrl = process.env['E2E_KANEO_URL']
  if (e2eUrl !== undefined) return e2eUrl
  const internalUrl = process.env['KANEO_INTERNAL_URL']
  if (internalUrl !== undefined) return internalUrl
  return 'http://localhost:11337'
}

function resolvePublicUrl(baseUrl: string): string {
  const publicUrl = process.env['KANEO_CLIENT_URL']
  if (publicUrl !== undefined) return publicUrl
  return baseUrl
}

async function performSetup(): Promise<E2EConfig> {
  const baseUrl = resolveBaseUrl()
  const publicUrl = resolvePublicUrl(baseUrl)

  log.info({ baseUrl, publicUrl }, 'Starting global E2E setup')

  try {
    await startKaneoServer()
    await waitForServer(baseUrl, DEFAULT_MAX_SERVER_ATTEMPTS)
  } catch (error) {
    log.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to start Kaneo server')
    throw error
  }

  try {
    // Use unique identifiers to avoid conflicts from previous test runs
    const uniqueSuffix = Date.now()
    const uniqueUsername = `e2e-test-${uniqueSuffix}`
    const uniqueTelegramId = 999999999 + (uniqueSuffix % 1000000)
    process.env['KANEO_INTERNAL_URL'] = baseUrl
    process.env['KANEO_CLIENT_URL'] = publicUrl
    const result = await provisionAndConfigure(String(uniqueTelegramId), uniqueUsername, {
      publicUrl,
      internalUrl: baseUrl,
    })
    if (result.status !== 'provisioned') {
      throw new Error(
        `Kaneo provisioning failed: ${result.status === 'failed' ? result.error : 'registration disabled'}`,
      )
    }

    e2eConfig = {
      baseUrl,
      apiKey: result.apiKey,
      workspaceId: result.workspaceId,
    }

    log.info({ workspaceId: result.workspaceId }, 'Global E2E setup complete')
    return e2eConfig
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.error({ error: message, baseUrl }, 'Failed to provision Kaneo user')
    throw error
  }
}

/**
 * Get or initialize the global E2E configuration.
 * This ensures setup runs only once across all test files.
 */
export function getE2EConfig(): Promise<E2EConfig> {
  if (e2eConfig !== undefined) {
    return Promise.resolve(e2eConfig)
  }

  const currentSetupPromise = setupPromise
  if (currentSetupPromise !== undefined) return currentSetupPromise

  const nextSetupPromise = performSetup()
  setupPromise = nextSetupPromise
  return nextSetupPromise
}

/**
 * Get the current E2E configuration (synchronous, throws if not initialized)
 */
export function getE2EConfigSync(): E2EConfig {
  if (e2eConfig === undefined) {
    throw new Error(
      '\n┌─────────────────────────────────────────────────────────────────┐\n' +
        '│ E2E tests require Docker environment setup.                      │\n' +
        '│                                                                  │\n' +
        '│ Run E2E tests with:   bun run test:e2e                          │\n' +
        '│                                                                  │\n' +
        '│ Or skip E2E tests by specifying paths:                          │\n' +
        '│   bun test tests/providers tests/tools tests/scripts ...        │\n' +
        '│                                                                  │\n' +
        '│ E2E tests cannot be run with bare "bun test" command.           │\n' +
        '└─────────────────────────────────────────────────────────────────┘\n',
    )
  }
  return e2eConfig
}

/**
 * Clean up global E2E resources. Should be called once after all tests.
 */
export async function cleanupE2E(): Promise<void> {
  log.info('Starting global E2E cleanup')
  e2eConfig = undefined
  setupPromise = undefined
  await stopKaneoServer()
  log.info('Global E2E cleanup complete')
}

// Auto-cleanup on process exit
process.on('exit', () => {
  if (e2eConfig !== undefined) {
    log.warn('Process exiting with E2E environment still active')
  }
})

process.on('SIGINT', () => {
  log.info('Received SIGINT, cleaning up...')
  void cleanupE2E().then(() => process.exit(0))
})

process.on('SIGTERM', () => {
  log.info('Received SIGTERM, cleaning up...')
  void cleanupE2E().then(() => process.exit(0))
})
