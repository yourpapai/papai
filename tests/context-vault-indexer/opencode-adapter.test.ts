// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  activateOpencodeAdapter,
  type AdapterDeps,
  type SpawnRequest,
} from '../../context-vault-indexer/adapters/opencode.js'
import {
  LOCK_FILE_NAME,
  refreshIndexerHeartbeat,
  type LockDeps,
  type LockFileSystem,
} from '../../context-vault-indexer/lock.js'

type FakeFs = LockFileSystem & { files: Map<string, string> }

const makeFakeFs = (seed: Record<string, string> = {}): FakeFs => {
  const files = new Map<string, string>(Object.entries(seed))
  return {
    files,
    readLock: (path: string) => files.get(path) ?? null,
    createExclusive: (path: string, contents: string) => {
      if (files.has(path)) return false
      files.set(path, contents)
      return true
    },
    write: (path: string, contents: string) => {
      files.set(path, contents)
    },
    remove: (path: string) => {
      files.delete(path)
    },
  }
}

const makeLockDeps = (fs: FakeFs, overrides: Partial<LockDeps> = {}): LockDeps => ({
  fs,
  isPidAlive: () => true,
  now: () => 100_000,
  ttlMs: 10_000,
  ...overrides,
})

const LOCK_PATH = `/state/${LOCK_FILE_NAME}`
const DAEMON_ENTRY = '/pkg/context-vault-indexer/daemon-main.ts'

const lockRecord = (pid: number, heartbeatAt: number): string => JSON.stringify({ pid, heartbeatAt })

const readLockJson = (fs: FakeFs): unknown => JSON.parse(fs.files.get(LOCK_PATH) ?? '')

const DAEMON_PID = 5555

const makeDeps = (fs: FakeFs, lockOverrides: Partial<LockDeps> = {}): { deps: AdapterDeps; spawns: SpawnRequest[] } => {
  const spawns: SpawnRequest[] = []
  return {
    spawns,
    deps: {
      lock: makeLockDeps(fs, lockOverrides),
      spawnDetached: (request: SpawnRequest) => {
        spawns.push(request)
        return DAEMON_PID
      },
      pid: 4242,
    },
  }
}

describe('opencode adapter activation', () => {
  test('no lock file: acquires the lock and spawns the daemon detached', () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs)

    const result = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)

    expect(result).toBe('spawned')
    expect(spawns).toEqual([
      { command: ['bun', 'run', DAEMON_ENTRY, '/state'], options: { detached: true, stdio: 'ignore' } },
    ])
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 100_000 })
  })

  test('a live lock held by another daemon is a no-op: no spawn, no lock mutation', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 99_000) })
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const result = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)

    expect(result).toBe('already-running')
    expect(spawns).toEqual([])
    expect(fs.files.get(LOCK_PATH)).toBe(lockRecord(1111, 99_000))
  })

  test('a stale lock is reclaimed and the daemon spawned', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 1_000) })
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const result = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)

    expect(result).toBe('spawned')
    expect(spawns).toHaveLength(1)
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 100_000 })
  })

  test('two activations through the same lock seam spawn exactly one daemon', () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs)

    const first = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)
    // The first activation's own PID now holds a fresh lock.
    const second = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)

    expect(first).toBe('spawned')
    expect(second).toBe('already-running')
    expect(spawns).toHaveLength(1)
  })

  test('a daemon that keeps refreshing its heartbeat survives past the TTL between activations', () => {
    let clock = 100_000
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs, { now: () => clock, isPidAlive: () => true })

    const first = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)
    // The daemon ticks past the original heartbeat's TTL and refreshes the lock.
    clock = 125_000
    refreshIndexerHeartbeat(LOCK_PATH, DAEMON_PID, deps.lock)
    // The next activation lands after the first heartbeat would have expired.
    clock = 130_000
    const second = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)

    expect(first).toBe('spawned')
    expect(second).toBe('already-running')
    expect(spawns).toHaveLength(1)
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 125_000 })
  })

  test('the lock stays held after the short-lived plugin process exits, while the daemon lives', () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const first = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, deps)
    refreshIndexerHeartbeat(LOCK_PATH, DAEMON_PID, deps.lock)
    // The plugin process (pid 4242) is gone; only the daemon's pid is alive.
    const later = makeDeps(fs, { isPidAlive: (pid: number) => pid === DAEMON_PID })
    const second = activateOpencodeAdapter({ stateDir: '/state', daemonEntry: DAEMON_ENTRY }, later.deps)

    expect(first).toBe('spawned')
    expect(second).toBe('already-running')
    expect(spawns).toHaveLength(1)
    expect(later.spawns).toHaveLength(0)
  })
})
