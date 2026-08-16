// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const LOCK_FILE_NAME = 'context-vault-indexer.lock'
export const DEFAULT_HEARTBEAT_TTL_MS = 10_000

export type LockFileSystem = {
  readLock(path: string): string | null
  createExclusive(path: string, contents: string): boolean
  write(path: string, contents: string): void
  remove(path: string): void
}

export type LockDeps = {
  fs: LockFileSystem
  isPidAlive(pid: number): boolean
  now(): number
  ttlMs?: number
}

export type AcquireResult = { acquired: true; lockPath: string } | { acquired: false; reason: 'held' }

const LockRecordSchema = z.object({ pid: z.number().int(), heartbeatAt: z.number() })

const serialize = (pid: number, heartbeatAt: number): string => JSON.stringify({ pid, heartbeatAt })

const parseRecord = (raw: string | null): { pid: number; heartbeatAt: number } | null => {
  if (raw === null) return null
  try {
    const parsed = LockRecordSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const isLive = (record: { pid: number; heartbeatAt: number }, deps: LockDeps, ttlMs: number): boolean =>
  deps.isPidAlive(record.pid) && deps.now() - record.heartbeatAt <= ttlMs

export function acquireIndexerLock(stateDir: string, pid: number, deps: LockDeps): AcquireResult {
  const ttlMs = deps.ttlMs ?? DEFAULT_HEARTBEAT_TTL_MS
  const lockPath = `${stateDir}/${LOCK_FILE_NAME}`

  if (deps.fs.createExclusive(lockPath, serialize(pid, deps.now()))) {
    return { acquired: true, lockPath }
  }

  const existing = parseRecord(deps.fs.readLock(lockPath))
  if (existing !== null && isLive(existing, deps, ttlMs)) {
    return { acquired: false, reason: 'held' }
  }

  deps.fs.remove(lockPath)
  if (deps.fs.createExclusive(lockPath, serialize(pid, deps.now()))) {
    return { acquired: true, lockPath }
  }
  return { acquired: false, reason: 'held' }
}

/**
 * Refreshes the holder's heartbeat. Returns false when the lock is no longer
 * held by `pid` (missing, corrupt, or reclaimed by another process), so the
 * caller can stop a superseded daemon instead of running alongside its
 * replacement forever.
 */
export function refreshIndexerHeartbeat(lockPath: string, pid: number, deps: LockDeps): boolean {
  const existing = parseRecord(deps.fs.readLock(lockPath))
  if (existing === null || existing.pid !== pid) return false
  deps.fs.write(lockPath, serialize(pid, deps.now()))
  return true
}

/**
 * Transfers a held lock record from the short-lived acquiring process to the
 * long-lived daemon process. Only rewrites when the record is still held by
 * `fromPid`, so a reclaimed lock is never resurrected.
 */
export function handoffIndexerLock(lockPath: string, fromPid: number, toPid: number, deps: LockDeps): void {
  const existing = parseRecord(deps.fs.readLock(lockPath))
  if (existing === null || existing.pid !== fromPid) return
  deps.fs.write(lockPath, serialize(toPid, deps.now()))
}
