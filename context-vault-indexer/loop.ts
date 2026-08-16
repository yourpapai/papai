// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'
import pino from 'pino'

import { scanOnce, type DaemonDeps, type DaemonFs, type DaemonConfig } from './daemon.js'
import { DEFAULT_HEARTBEAT_TTL_MS, refreshIndexerHeartbeat, type LockDeps } from './lock.js'

const logger = pino({ base: undefined, timestamp: pino.stdTimeFunctions.isoTime })

/** Repos are few (one per open project) and each push already retries. */
const REPO_SCAN_CONCURRENCY = 4

/**
 * Lock ownership seam: the daemon holds the singleton lock under its own pid
 * and rewrites `heartbeatAt` on its own cadence (at least twice per heartbeat
 * TTL, independent of the scan interval), so the lock outlives the short-lived
 * plugin process that spawned it.
 */
export type DaemonHeartbeat = {
  lockPath: string
  pid: number
  lock: LockDeps
}

/** One registered repository: its push config paired with its own state file. */
export type RepoRuntime = { config: DaemonConfig; fs: DaemonFs }

/** Loop-level deps; the filesystem arrives per repo through {@link RepoRuntime}. */
export type DaemonLoopDeps = Omit<DaemonDeps, 'fs'> & { heartbeat?: DaemonHeartbeat }

export type RunDaemonOptions = {
  intervalMs: number
  signal: AbortSignal
  /** Called after every completed scan pass, so status can surface freshness. */
  onScan?: () => void
}

/**
 * Scans a tick's repo snapshot under a bounded concurrency limit. Each repo is
 * isolated: one whose spec dir vanished must not cost the others their scan,
 * and `scanOnce` already retries its own pushes with backoff.
 */
const scanAllRepos = async (repos: readonly RepoRuntime[], deps: DaemonLoopDeps): Promise<void> => {
  const limit = pLimit(REPO_SCAN_CONCURRENCY)
  await Promise.all(
    repos.map((repo) =>
      limit(() =>
        scanOnce(repo.config, { ...deps, fs: repo.fs }).catch((error: unknown) => {
          logger.error(
            { repo: repo.config.repo, error: error instanceof Error ? error.message : String(error) },
            'context-vault indexer scan failed for a repo; continuing with the rest',
          )
        }),
      ),
    ),
  )
}

const fallbackSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const refreshHeartbeat = (heartbeat: DaemonHeartbeat): boolean => {
  try {
    return refreshIndexerHeartbeat(heartbeat.lockPath, heartbeat.pid, heartbeat.lock)
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'context-vault indexer heartbeat refresh failed; continuing after interval',
    )
    return true
  }
}

/** True while this daemon still owns the lock (or runs without one). */
const stillOwnsLock = (deps: DaemonLoopDeps): boolean => {
  if (!deps.heartbeat) return true
  if (refreshHeartbeat(deps.heartbeat)) return true
  logger.warn(
    { lockPath: deps.heartbeat.lockPath, pid: deps.heartbeat.pid },
    'context-vault indexer lost the singleton lock; superseded daemon exiting',
  )
  return false
}

const runScanPass = (
  getRepos: () => readonly RepoRuntime[],
  deps: DaemonLoopDeps,
  options: RunDaemonOptions,
): Promise<void> =>
  // Snapshot at tick start: a registration arriving mid-tick applies to the
  // next one rather than mutating the set being iterated.
  scanAllRepos(getRepos(), deps)
    .then(() => options.onScan?.())
    .catch((error: unknown) => {
      logger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'context-vault indexer scan tick failed; continuing after interval',
      )
    })

const sleepStep = (deps: DaemonLoopDeps, options: RunDaemonOptions, stepMs: number): Promise<void> => {
  if (options.signal.aborted) return Promise.resolve()
  return deps.sleep(stepMs).catch((error: unknown) => {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'context-vault indexer sleep failed; continuing after interval',
    )
    return options.signal.aborted ? undefined : fallbackSleep(stepMs)
  })
}

/**
 * Periodic scan loop over every registered repository. Chained promise
 * scheduling rather than an awaited loop so no pending frame accumulates across
 * iterations of a long-lived process. Resolves once the abort signal fires, or
 * once this daemon is superseded and loses its lock.
 *
 * The heartbeat is refreshed on its own cadence — at least twice per heartbeat
 * TTL — decoupled from `intervalMs`, so a scan interval longer than the TTL
 * never lets a live daemon's lock look reclaimable.
 */
export function runDaemon(
  getRepos: () => readonly RepoRuntime[],
  deps: DaemonLoopDeps,
  options: RunDaemonOptions,
): Promise<void> {
  return new Promise((resolve) => {
    const heartbeatTtlMs = deps.heartbeat?.lock.ttlMs ?? DEFAULT_HEARTBEAT_TTL_MS
    const stepMs = deps.heartbeat ? Math.min(options.intervalMs, Math.floor(heartbeatTtlMs / 2)) : options.intervalMs
    let sinceScanMs = options.intervalMs

    const tick = (): void => {
      if (options.signal.aborted || !stillOwnsLock(deps)) {
        resolve()
        return
      }
      const scanDue = sinceScanMs >= options.intervalMs
      const scanned = scanDue ? runScanPass(getRepos, deps, options) : Promise.resolve()
      if (scanDue) sinceScanMs = 0

      void scanned
        .then(() => sleepStep(deps, options, stepMs))
        .then(() => {
          sinceScanMs += stepMs
          if (options.signal.aborted) {
            resolve()
            return
          }
          tick()
        })
    }
    tick()
  })
}
