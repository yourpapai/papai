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
      void handler()
    })
  },
}

const readAdminUserId = (): string => process.env['ADMIN_USER_ID']?.trim() ?? ''

function productionConfig(adminUserId: string): PapaiRuntimeConfig {
  return {
    adminUserId,
    pluginDirectory: 'plugins',
    startBackgroundServices: true,
    startNetworkServer: true,
    sendStartupAnnouncement: true,
  }
}

export async function runProduction(
  deps: ProductionShellDeps = defaultShellDeps,
  loggerOverride: Partial<ShellLogger> = {},
): Promise<void> {
  const shellLog: ShellLogger = {
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

  const shutdown = async (signal: Signal): Promise<void> => {
    shellLog.info(`${signal} received, starting graceful shutdown...`)
    await runtime.stop()
    deps.exit(0)
  }
  deps.onSignal('SIGTERM', () => shutdown('SIGTERM'))
  deps.onSignal('SIGINT', () => shutdown('SIGINT'))
}

if (import.meta.main) await runProduction()
