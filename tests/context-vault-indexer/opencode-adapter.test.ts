// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  activateOpencodeAdapter,
  type ActivateResult,
  type AdapterDeps,
  type RegisterCall,
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

type RegisterScript = ({ action: 'registered' | 'updated' | 'unchanged' } | { throws: string })[]

type DepsHarness = {
  deps: AdapterDeps
  spawns: SpawnRequest[]
  registrations: RegisterCall[]
  sleeps: number[]
}

const makeDeps = (
  fs: FakeFs,
  lockOverrides: Partial<LockDeps> = {},
  registerScript: RegisterScript = [{ action: 'registered' }],
): DepsHarness => {
  const spawns: SpawnRequest[] = []
  const registrations: RegisterCall[] = []
  const sleeps: number[] = []
  let attempt = 0
  return {
    spawns,
    registrations,
    sleeps,
    deps: {
      lock: makeLockDeps(fs, lockOverrides),
      spawnDetached: (request: SpawnRequest) => {
        spawns.push(request)
        return DAEMON_PID
      },
      register: (call: RegisterCall) => {
        registrations.push(call)
        const step = registerScript[Math.min(attempt, registerScript.length - 1)]
        attempt += 1
        if (step !== undefined && 'throws' in step) return Promise.reject(new Error(step.throws))
        return Promise.resolve({ ok: true as const, repo: call.repo, action: step?.action ?? 'registered' })
      },
      sleep: (ms: number) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
      pid: 4242,
    },
  }
}

const REPO = { repo: 'papai', specDir: '/home/u/papai/openspec/changes' }

const activate = (deps: AdapterDeps, stateDir = '/state'): Promise<ActivateResult> =>
  activateOpencodeAdapter({ stateDir, daemonEntry: DAEMON_ENTRY, ...REPO }, deps)

/** Reads a recorded backoff delay without an in-test fallback expression. */
const sleepAt = (sleeps: number[], index: number): number => {
  const value = sleeps[index]
  if (value === undefined) throw new Error(`expected a recorded sleep at index ${index}`)
  return value
}

describe('opencode adapter activation', () => {
  test('no lock file: acquires the lock and spawns the daemon detached', async () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs)

    const result = await activate(deps)

    expect(result.daemon).toBe('spawned')
    expect(spawns).toEqual([
      { command: ['bun', 'run', DAEMON_ENTRY, '/state'], options: { detached: true, stdio: 'ignore' } },
    ])
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 100_000 })
  })

  test('a live lock held by another daemon spawns nothing and leaves the lock untouched', async () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 99_000) })
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const result = await activate(deps)

    expect(result.daemon).toBe('already-running')
    expect(spawns).toEqual([])
    expect(fs.files.get(LOCK_PATH)).toBe(lockRecord(1111, 99_000))
  })

  test('a stale lock is reclaimed and the daemon spawned', async () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 1_000) })
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const result = await activate(deps)

    expect(result.daemon).toBe('spawned')
    expect(spawns).toHaveLength(1)
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 100_000 })
  })

  test('two activations through the same lock seam spawn exactly one daemon', async () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs)

    const first = await activate(deps)
    // The first activation's own PID now holds a fresh lock.
    const second = await activate(deps)

    expect(first.daemon).toBe('spawned')
    expect(second.daemon).toBe('already-running')
    expect(spawns).toHaveLength(1)
  })

  test('a daemon that keeps refreshing its heartbeat survives past the TTL between activations', async () => {
    let clock = 100_000
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs, { now: () => clock, isPidAlive: () => true })

    const first = await activate(deps)
    // The daemon ticks past the original heartbeat's TTL and refreshes the lock.
    clock = 125_000
    refreshIndexerHeartbeat(LOCK_PATH, DAEMON_PID, deps.lock)
    // The next activation lands after the first heartbeat would have expired.
    clock = 130_000
    const second = await activate(deps)

    expect(first.daemon).toBe('spawned')
    expect(second.daemon).toBe('already-running')
    expect(spawns).toHaveLength(1)
    expect(readLockJson(fs)).toEqual({ pid: DAEMON_PID, heartbeatAt: 125_000 })
  })

  test('the lock stays held after the short-lived plugin process exits, while the daemon lives', async () => {
    const fs = makeFakeFs()
    const { deps, spawns } = makeDeps(fs, { isPidAlive: () => true })

    const first = await activate(deps)
    refreshIndexerHeartbeat(LOCK_PATH, DAEMON_PID, deps.lock)
    // The plugin process (pid 4242) is gone; only the daemon's pid is alive.
    const later = makeDeps(fs, { isPidAlive: (pid: number) => pid === DAEMON_PID })
    const second = await activate(later.deps)

    expect(first.daemon).toBe('spawned')
    expect(second.daemon).toBe('already-running')
    expect(spawns).toHaveLength(1)
    expect(later.spawns).toHaveLength(0)
  })

  test('registers the session repo with the daemon it just spawned', async () => {
    const fs = makeFakeFs()
    const { deps, registrations } = makeDeps(fs)

    const result = await activate(deps)

    expect(result).toEqual({ daemon: 'spawned', registration: 'registered' })
    expect(registrations).toEqual([{ socketPath: '/state/context-vault-indexer.sock', ...REPO }])
  })

  test('registers with the running daemon instead of no-oping when the lock is held', async () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 99_000) })
    const { deps, spawns, registrations } = makeDeps(fs, { isPidAlive: () => true }, [{ action: 'unchanged' }])

    const result = await activate(deps)

    expect(result).toEqual({ daemon: 'already-running', registration: 'unchanged' })
    expect(spawns).toEqual([])
    expect(registrations).toHaveLength(1)
  })

  test('retries a refused connection on a bounded schedule while the daemon binds', async () => {
    const fs = makeFakeFs()
    const { deps, registrations, sleeps } = makeDeps(fs, {}, [
      { throws: 'ENOENT' },
      { throws: 'ECONNREFUSED' },
      { action: 'registered' },
    ])

    const result = await activate(deps)

    expect(result).toEqual({ daemon: 'spawned', registration: 'registered' })
    expect(registrations).toHaveLength(3)
    expect(sleeps.length).toBe(2)
    expect(sleepAt(sleeps, 1)).toBeGreaterThan(sleepAt(sleeps, 0))
  })

  test('gives up after the attempt budget without throwing into the session', async () => {
    const fs = makeFakeFs()
    const { deps, registrations } = makeDeps(fs, {}, [{ throws: 'ECONNREFUSED' }])

    const result = await activate(deps)

    expect(result).toEqual({ daemon: 'spawned', registration: 'failed' })
    expect(registrations.length).toBeLessThanOrEqual(5)
  })

  test('a daemon-side rejection is reported without throwing', async () => {
    const fs = makeFakeFs()
    const { deps } = makeDeps(fs)
    const rejecting: AdapterDeps = {
      ...deps,
      register: () => Promise.resolve({ ok: false as const, error: 'Spec directory does not exist: /nope' }),
    }

    const result = await activate(rejecting)

    expect(result).toEqual({ daemon: 'spawned', registration: 'failed' })
  })

  test('a spawn failure does not throw into the coding-agent session', async () => {
    const fs = makeFakeFs()
    const { deps } = makeDeps(fs)
    const failing: AdapterDeps = {
      ...deps,
      spawnDetached: () => {
        throw new Error('spawn blocked')
      },
    }

    const result = await activate(failing)

    expect(result.daemon).toBe('spawned')
    expect(result.registration).toBe('failed')
  })
})
