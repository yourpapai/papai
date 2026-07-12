// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { logger } from './logger.js'
import { createPapaiRuntime } from './runtime/create-runtime.js'
import { createProductionRuntimeDeps } from './runtime/production-deps.js'
import type { PapaiRuntime, PapaiRuntimeConfig, PapaiRuntimeDeps } from './runtime/types.js'

const log = logger.child({ scope: 'main' })

type Signal = 'SIGINT' | 'SIGTERM'

export type ProductionShellDeps = {
  createDeps(): PapaiRuntimeDeps
  createRuntime(config: PapaiRuntimeConfig, deps: PapaiRuntimeDeps): PapaiRuntime
  exit(code: number): void
  onSignal(signal: Signal, handler: () => Promise<void>): void
}

type ShellLogger = Readonly<{
  error(data: unknown, message: string): void
  info(message: string): void
}>

const defaultShellDeps: ProductionShellDeps = {
  createDeps: createProductionRuntimeDeps,
  createRuntime: createPapaiRuntime,
  exit: (code) => process.exit(code),
  onSignal: (signal, handler) => {
    process.on(signal, () => {
      void handler().catch((error: unknown) => {
        log.error({ error: error instanceof Error ? error.message : String(error) }, 'Papai signal handler failed')
        process.exit(1)
      })
    })
  },
}

const readAdminUserId = (): string => process.env['ADMIN_USER_ID']?.trim() ?? ''

function createShellLogger(loggerOverride: Partial<ShellLogger>): ShellLogger {
  return {
    error:
      loggerOverride.error ??
      ((data, message) => {
        log.error(data, message)
      }),
    info:
      loggerOverride.info ??
      ((message) => {
        log.info(message)
      }),
  }
}

function productionConfig(adminUserId: string): PapaiRuntimeConfig {
  return {
    adminUserId,
    pluginDirectory: 'plugins',
    startBackgroundServices: true,
    startNetworkServer: true,
    sendStartupAnnouncement: true,
  }
}

function registerShutdownHandlers(runtime: PapaiRuntime, deps: ProductionShellDeps, shellLog: ShellLogger): void {
  let shutdownInFlight: Promise<void> | undefined
  const shutdown = (signal: Signal): Promise<void> => {
    if (shutdownInFlight !== undefined) return shutdownInFlight
    shutdownInFlight = (async (): Promise<void> => {
      shellLog.info(`${signal} received, starting graceful shutdown...`)
      try {
        await runtime.stop()
        deps.exit(0)
      } catch (error) {
        shellLog.error({ error: error instanceof Error ? error.message : String(error) }, 'Papai shutdown failed')
        deps.exit(1)
      }
    })()
    return shutdownInFlight
  }
  deps.onSignal('SIGTERM', () => shutdown('SIGTERM'))
  deps.onSignal('SIGINT', () => shutdown('SIGINT'))
}

export async function runProduction(
  deps: ProductionShellDeps = defaultShellDeps,
  loggerOverride: Partial<ShellLogger> = {},
): Promise<void> {
  const shellLog = createShellLogger(loggerOverride)
  const adminUserId = readAdminUserId()
  if (adminUserId === '') {
    shellLog.error({ variables: ['ADMIN_USER_ID'] }, 'Missing required environment variables')
    deps.exit(1)
    return
  }

  shellLog.info('Starting papai...')
  const runtime = deps.createRuntime(productionConfig(adminUserId), deps.createDeps())
  try {
    await runtime.start()
  } catch (error) {
    shellLog.error({ error: error instanceof Error ? error.message : String(error) }, 'Papai startup failed')
    deps.exit(1)
    return
  }

  registerShutdownHandlers(runtime, deps, shellLog)
}

if (import.meta.main) await runProduction()
