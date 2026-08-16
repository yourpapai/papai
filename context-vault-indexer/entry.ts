// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { configPathOf, readConfig, resolveToken, type ConfigFs, type IndexerConfig } from './config.js'
import type { DaemonFs } from './daemon.js'
import { socketPathOf, type IpcHandler, type IpcServer } from './ipc.js'
import {
  acquireIndexerLock,
  LOCK_FILE_NAME,
  refreshIndexerHeartbeat,
  releaseIndexerLock,
  type LockDeps,
} from './lock.js'
import type { DaemonLoopDeps, RepoRuntime, RunDaemonOptions } from './loop.js'
import { createRepoRegistry, type RepoRegistry } from './registry.js'
import type { IdentityFs } from './repo-identity.js'

export type EntryDeps = {
  env: Record<string, string | undefined>
  pid: number
  now(): number
  configFs: ConfigFs
  identityFs: IdentityFs
  lock: LockDeps
  dirExists(path: string): boolean
  ensureStateDir(dir: string): void
  /** One scan-state file per repository, keyed by its identity hash. */
  makeDaemonFs(stateKey: string): DaemonFs
  startServer(socketPath: string, handler: IpcHandler): Promise<IpcServer>
  runLoop(getRepos: () => readonly RepoRuntime[], deps: DaemonLoopDeps, options: RunDaemonOptions): Promise<void>
  push: DaemonLoopDeps['push']
  sleep: DaemonLoopDeps['sleep']
  onSignal(handler: () => void): void
  log(message: string): void
}

export type StartResult = { code: number; error?: string }

type LockClaim = 'owned' | 'held-by-other'

/**
 * The adapter hands the lock off to the spawned daemon's pid before the daemon
 * has started, so on startup the record usually already names us: refreshing it
 * succeeds and we adopt it. Only when it does not do we contend for it, which
 * is the manual-start path.
 */
const claimLock = (stateDir: string, deps: EntryDeps): LockClaim => {
  const lockPath = `${stateDir}/${LOCK_FILE_NAME}`
  if (refreshIndexerHeartbeat(lockPath, deps.pid, deps.lock)) return 'owned'
  return acquireIndexerLock(stateDir, deps.pid, deps.lock).acquired ? 'owned' : 'held-by-other'
}

const repoRuntimesOf = (registry: RepoRegistry, config: IndexerConfig, token: string, deps: EntryDeps): RepoRuntime[] =>
  registry.runtimes().map((entry): RepoRuntime => ({
    config: { repo: entry.repo, specDir: entry.specDir, pushUrl: config.pushUrl, token },
    fs: deps.makeDaemonFs(entry.stateKey),
  }))

const buildHandler = (registry: RepoRegistry): IpcHandler => ({
  register: (input) => registry.register(input),
  status: () => ({ repos: registry.list(), lastScanAt: registry.lastScanAt() }),
})

/**
 * Starts the indexer daemon and resolves once it has shut down. Every failure
 * before the loop starts is fatal rather than degraded: a missing token would
 * mean an invisible 401 retry loop, and a config the daemon cannot read would
 * mean scanning nothing while looking healthy.
 *
 * Finding the lock held by another live daemon is not a failure — it is the
 * singleton working — so that path exits zero.
 */
export async function startIndexer(stateDir: string, deps: EntryDeps): Promise<StartResult> {
  deps.ensureStateDir(stateDir)

  const token = resolveToken(deps.env)
  if (!token.ok) return { code: 1, error: token.error }

  const config = readConfig(stateDir, deps.configFs)
  if (!config.ok) return { code: 1, error: config.error }

  if (claimLock(stateDir, deps) === 'held-by-other') {
    deps.log('another context-vault indexer holds the singleton lock; standing down')
    return { code: 0 }
  }

  const registry = createRepoRegistry(config.config, {
    stateDir,
    configFs: deps.configFs,
    identityFs: deps.identityFs,
    dirExists: (path: string) => deps.dirExists(path),
  })

  await serveUntilShutdown(stateDir, registry, config.config, token.token, deps)
  return { code: 0 }
}

/**
 * Binds the registration socket, runs the scan loop, and unwinds both on
 * shutdown. The lock is released only while it still names our pid, so a
 * superseded daemon never deletes its replacement's lock.
 */
const serveUntilShutdown = async (
  stateDir: string,
  registry: RepoRegistry,
  config: IndexerConfig,
  token: string,
  deps: EntryDeps,
): Promise<void> => {
  const controller = new AbortController()
  deps.onSignal(() => {
    controller.abort()
  })

  const server = await deps.startServer(socketPathOf(stateDir), buildHandler(registry))
  deps.log(`context-vault indexer watching ${registry.list().length} repo(s) from ${configPathOf(stateDir)}`)

  try {
    await deps.runLoop(
      () => repoRuntimesOf(registry, config, token, deps),
      {
        push: deps.push,
        sleep: deps.sleep,
        heartbeat: { lockPath: `${stateDir}/${LOCK_FILE_NAME}`, pid: deps.pid, lock: deps.lock },
      },
      {
        intervalMs: config.intervalMs,
        signal: controller.signal,
        onScan: () => {
          registry.markScan(deps.now())
        },
      },
    )
  } finally {
    server.close()
    releaseIndexerLock(`${stateDir}/${LOCK_FILE_NAME}`, deps.pid, deps.lock)
  }
}
