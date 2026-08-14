// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'

import pino from 'pino'
import { z } from 'zod'

import { DEFAULT_HEARTBEAT_TTL_MS, refreshIndexerHeartbeat, type LockDeps } from './lock.js'

const logger = pino({ base: undefined, timestamp: pino.stdTimeFunctions.isoTime })

export type DaemonFs = {
  /** Relative paths of every `*.md` file under dir, sorted. */
  listMarkdownFiles(dir: string): string[]
  readFile(path: string): string | null
  statMtime(path: string): number
  readState(): string | null
  writeState(contents: string): void
}

export type PushCall = {
  url: string
  bearer: string
  body: string
}

export type PushOutcome = { ok: boolean; status: number }

export type DaemonConfig = {
  repo: string
  specDir: string
  pushUrl: string
  token: string
}

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

export type DaemonDeps = {
  fs: DaemonFs
  push(url: string, bearer: string, body: string): Promise<PushOutcome>
  sleep(ms: number): Promise<void>
  backoffBaseMs?: number
  maxPushAttempts?: number
  heartbeat?: DaemonHeartbeat
}

export type ScanResult = {
  scanned: number
  pushedChanges: number
  failedChanges: number
}

type FileEntry = { hash: string; mtime: number }

type CurrentFile = FileEntry & { path: string; text: string }

const StateSchema = z.object({ files: z.record(z.string(), z.object({ hash: z.string(), mtime: z.number() })) })

const sha256Hex = (text: string): string => createHash('sha256').update(text).digest('hex')

const changeNameOf = (relPath: string): string | null => {
  const slash = relPath.indexOf('/')
  if (slash <= 0) return null
  return relPath.slice(0, slash)
}

const kindOf = (relPath: string): string => {
  const base = relPath.slice(relPath.lastIndexOf('/') + 1)
  return base.endsWith('.md') ? base.slice(0, -3) : base
}

const parseState = (raw: string | null): Record<string, FileEntry> => {
  if (raw === null) return {}
  try {
    const parsed = StateSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data.files : {}
  } catch {
    return {}
  }
}

const scanCurrent = (config: DaemonConfig, fs: DaemonFs): CurrentFile[] => {
  const out: CurrentFile[] = []
  for (const rel of fs.listMarkdownFiles(config.specDir)) {
    if (changeNameOf(rel) === null) continue
    const text = fs.readFile(`${config.specDir}/${rel}`)
    if (text === null) continue
    out.push({ path: rel, text, hash: sha256Hex(text), mtime: fs.statMtime(`${config.specDir}/${rel}`) })
  }
  return out
}

const attemptPush = async (
  config: DaemonConfig,
  deps: DaemonDeps,
  body: string,
  attempt: number,
  maxAttempts: number,
  baseMs: number,
): Promise<boolean> => {
  let outcome: PushOutcome
  try {
    outcome = await deps.push(config.pushUrl, config.token, body)
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error), attempt },
      'context-vault indexer push rejected; treating as retryable failure',
    )
    outcome = { ok: false, status: 0 }
  }
  if (outcome.ok) return true
  if (attempt >= maxAttempts) return false
  await deps.sleep(baseMs * 2 ** (attempt - 1))
  return attemptPush(config, deps, body, attempt + 1, maxAttempts, baseMs)
}

const pushWithBackoff = (config: DaemonConfig, deps: DaemonDeps, body: string): Promise<boolean> =>
  attemptPush(config, deps, body, 1, deps.maxPushAttempts ?? 3, deps.backoffBaseMs ?? 1_000)

type PushLoopState = {
  nextPersisted: Map<string, FileEntry>
  pushedChanges: number
  failedChanges: number
  anySucceeded: boolean
}

const processChange = async (
  state: PushLoopState,
  changeName: string,
  changed: CurrentFile[],
  deleted: string[],
  config: DaemonConfig,
  deps: DaemonDeps,
): Promise<PushLoopState> => {
  const files = changed
    .filter((f) => changeNameOf(f.path) === changeName)
    .map((f) => ({ path: f.path, kind: kindOf(f.path), hash: f.hash, mtime: f.mtime, text: f.text }))
  const deletions = deleted.filter((path) => changeNameOf(path) === changeName).toSorted()
  const body = JSON.stringify({ repo: config.repo, changeName, files, deletions })
  const ok = await pushWithBackoff(config, deps, body)
  if (!ok) return { ...state, failedChanges: state.failedChanges + 1 }
  for (const f of files) state.nextPersisted.set(f.path, { hash: f.hash, mtime: f.mtime })
  for (const path of deletions) state.nextPersisted.delete(path)
  return { ...state, pushedChanges: state.pushedChanges + 1, anySucceeded: true }
}

export async function scanOnce(config: DaemonConfig, deps: DaemonDeps): Promise<ScanResult> {
  const current = scanCurrent(config, deps.fs)
  const persisted = parseState(deps.fs.readState())

  const currentPaths = new Set(current.map((f) => f.path))
  const changed = current.filter((f) => persisted[f.path]?.hash !== f.hash)
  const deleted = Object.keys(persisted).filter((path) => !currentPaths.has(path))

  const changeNames = [
    ...new Set(
      [...changed.map((f) => f.path), ...deleted]
        .map((path) => changeNameOf(path))
        .filter((name): name is string => name !== null),
    ),
  ].toSorted()

  const initial: PushLoopState = {
    nextPersisted: new Map<string, FileEntry>(Object.entries(persisted)),
    pushedChanges: 0,
    failedChanges: 0,
    anySucceeded: false,
  }

  const final = await changeNames.reduce<Promise<PushLoopState>>(
    (prev, changeName) => prev.then((state) => processChange(state, changeName, changed, deleted, config, deps)),
    Promise.resolve(initial),
  )

  if (final.anySucceeded) deps.fs.writeState(JSON.stringify({ files: Object.fromEntries(final.nextPersisted) }))

  return { scanned: current.length, pushedChanges: final.pushedChanges, failedChanges: final.failedChanges }
}

export type RunDaemonOptions = {
  intervalMs: number
  signal: AbortSignal
}

/**
 * Periodic scan loop. Chained promise scheduling rather than an awaited loop so
 * no pending frame accumulates across iterations of a long-lived process.
 * Resolves once the abort signal fires.
 *
 * The heartbeat is refreshed on its own cadence — at least twice per heartbeat
 * TTL — decoupled from `intervalMs`, so a scan interval longer than the TTL
 * never lets a live daemon's lock look reclaimable.
 */
export function runDaemon(config: DaemonConfig, deps: DaemonDeps, options: RunDaemonOptions): Promise<void> {
  return new Promise((resolve) => {
    const heartbeatTtlMs = deps.heartbeat?.lock.ttlMs ?? DEFAULT_HEARTBEAT_TTL_MS
    const stepMs = deps.heartbeat ? Math.min(options.intervalMs, Math.floor(heartbeatTtlMs / 2)) : options.intervalMs
    let sinceScanMs = options.intervalMs
    const tick = (): void => {
      if (options.signal.aborted) {
        resolve()
        return
      }
      if (deps.heartbeat) {
        refreshIndexerHeartbeat(deps.heartbeat.lockPath, deps.heartbeat.pid, deps.heartbeat.lock)
      }
      const scanDue = sinceScanMs >= options.intervalMs
      const scanned = scanDue
        ? scanOnce(config, deps).catch((error: unknown) => {
            logger.error(
              { error: error instanceof Error ? error.message : String(error) },
              'context-vault indexer scan tick failed; continuing after interval',
            )
          })
        : Promise.resolve()
      if (scanDue) sinceScanMs = 0
      void scanned
        .then(() => (options.signal.aborted ? undefined : deps.sleep(stepMs)))
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
