// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  acquireIndexerLock,
  releaseIndexerLock,
  handoffIndexerLock,
  LOCK_FILE_NAME,
  refreshIndexerHeartbeat,
  type LockDeps,
  type LockFileSystem,
} from '../../context-vault-indexer/lock.js'

type FakeFs = LockFileSystem & {
  files: Map<string, string>
  removed: string[]
}

const makeFakeFs = (seed: Record<string, string> = {}): FakeFs => {
  const files = new Map<string, string>(Object.entries(seed))
  const removed: string[] = []
  return {
    files,
    removed,
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
      removed.push(path)
      files.delete(path)
    },
  }
}

const makeDeps = (overrides: Partial<LockDeps> & { fs: FakeFs }): LockDeps => ({
  isPidAlive: () => true,
  now: () => 100_000,
  ttlMs: 10_000,
  ...overrides,
})

const LOCK_PATH = `/state/${LOCK_FILE_NAME}`

const lockRecord = (pid: number, heartbeatAt: number): string => JSON.stringify({ pid, heartbeatAt })

const readLockJson = (fs: FakeFs): unknown => JSON.parse(fs.files.get(LOCK_PATH) ?? '')

// The first createExclusive loses to a rival that installs a fresh live lock;
// subsequent calls delegate to the backing fake.
const makeContendedFs = (): FakeFs => {
  const base = makeFakeFs()
  let calls = 0
  return {
    ...base,
    createExclusive: (path: string, contents: string) => {
      calls += 1
      if (calls === 1) {
        base.files.set(path, lockRecord(1111, 100_000))
        return false
      }
      return base.createExclusive(path, contents)
    },
    readLock: (path: string) => base.files.get(path) ?? null,
  }
}

describe('context-vault-indexer lock', () => {
  test('acquires the lock when no lock file exists, writing pid and heartbeat', () => {
    const fs = makeFakeFs()
    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs }))

    expect(result).toEqual({ acquired: true, lockPath: LOCK_PATH })
    expect(readLockJson(fs)).toEqual({ pid: 4242, heartbeatAt: 100_000 })
  })

  test('a live PID with a fresh heartbeat is a no-op', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 95_000) })
    const isPidAlive = (pid: number): boolean => pid === 1111

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs, isPidAlive }))

    expect(result).toEqual({ acquired: false, reason: 'held' })
    expect(fs.files.get(LOCK_PATH)).toBe(lockRecord(1111, 95_000))
    expect(fs.removed).toEqual([])
  })

  test('a dead PID is reclaimed even when the heartbeat looks fresh', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 99_000) })
    const isPidAlive = (pid: number): boolean => pid !== 1111

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs, isPidAlive }))

    expect(result).toEqual({ acquired: true, lockPath: LOCK_PATH })
    expect(fs.removed).toEqual([LOCK_PATH])
    expect(readLockJson(fs)).toEqual({ pid: 4242, heartbeatAt: 100_000 })
  })

  test('an expired heartbeat is reclaimed even when the PID is alive', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 80_000) })
    const isPidAlive = (): boolean => true

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs, isPidAlive }))

    expect(result).toEqual({ acquired: true, lockPath: LOCK_PATH })
    expect(readLockJson(fs)).toEqual({ pid: 4242, heartbeatAt: 100_000 })
  })

  test('a heartbeat exactly at the TTL boundary is still fresh', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 90_000) })
    const isPidAlive = (): boolean => true

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs, isPidAlive }))

    expect(result).toEqual({ acquired: false, reason: 'held' })
  })

  test('a corrupt lock file is reclaimed', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: 'not json' })

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs }))

    expect(result).toEqual({ acquired: true, lockPath: LOCK_PATH })
    expect(readLockJson(fs)).toEqual({ pid: 4242, heartbeatAt: 100_000 })
  })

  test('a concurrent contender that wins the re-create leaves us unacquired', () => {
    // The existing lock is stale, but every createExclusive call fails: a rival
    // process re-creates the file between our remove and our create.
    const base = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 1_000) })
    const fs: FakeFs = { ...base, createExclusive: () => false }

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs }))

    expect(result).toEqual({ acquired: false, reason: 'held' })
  })

  test('a concurrent contender holding a fresh live lock blocks acquisition on first sight', () => {
    const fs = makeContendedFs()

    const result = acquireIndexerLock('/state', 4242, makeDeps({ fs, isPidAlive: () => true }))

    expect(result).toEqual({ acquired: false, reason: 'held' })
  })

  test('refreshIndexerHeartbeat rewrites the heartbeat for the current holder', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(4242, 100_000) })

    refreshIndexerHeartbeat(LOCK_PATH, 4242, makeDeps({ fs, now: () => 105_000 }))

    expect(readLockJson(fs)).toEqual({ pid: 4242, heartbeatAt: 105_000 })
  })

  test('refreshIndexerHeartbeat does not overwrite another holder', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 100_000) })

    refreshIndexerHeartbeat(LOCK_PATH, 4242, makeDeps({ fs, now: () => 105_000 }))

    expect(readLockJson(fs)).toEqual({ pid: 1111, heartbeatAt: 100_000 })
  })

  test('handoffIndexerLock transfers the record from the acquirer to the daemon pid', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(4242, 100_000) })

    handoffIndexerLock(LOCK_PATH, 4242, 5555, makeDeps({ fs, now: () => 101_000 }))

    expect(readLockJson(fs)).toEqual({ pid: 5555, heartbeatAt: 101_000 })
  })

  test('handoffIndexerLock does not steal a lock held by another pid', () => {
    const fs = makeFakeFs({ [LOCK_PATH]: lockRecord(1111, 100_000) })

    handoffIndexerLock(LOCK_PATH, 4242, 5555, makeDeps({ fs, now: () => 101_000 }))

    expect(readLockJson(fs)).toEqual({ pid: 1111, heartbeatAt: 100_000 })
  })

  test('handoffIndexerLock does not resurrect a missing lock', () => {
    const fs = makeFakeFs()

    handoffIndexerLock(LOCK_PATH, 4242, 5555, makeDeps({ fs, now: () => 101_000 }))

    expect(fs.files.has(LOCK_PATH)).toBe(false)
  })

  describe('releaseIndexerLock', () => {
    test('removes a lock still held by the releasing pid', () => {
      const fs = makeFakeFs({ [LOCK_PATH]: JSON.stringify({ pid: 5555, heartbeatAt: 100_000 }) })

      releaseIndexerLock(LOCK_PATH, 5555, makeDeps({ fs }))

      expect(fs.files.has(LOCK_PATH)).toBe(false)
    })

    test('leaves a lock reclaimed by another daemon alone', () => {
      const record = JSON.stringify({ pid: 1111, heartbeatAt: 100_000 })
      const fs = makeFakeFs({ [LOCK_PATH]: record })

      releaseIndexerLock(LOCK_PATH, 5555, makeDeps({ fs }))

      expect(fs.files.get(LOCK_PATH)).toBe(record)
    })

    test('is a no-op when the lock file is already gone', () => {
      const fs = makeFakeFs()

      expect(() => releaseIndexerLock(LOCK_PATH, 5555, makeDeps({ fs }))).not.toThrow()
    })
  })
})
