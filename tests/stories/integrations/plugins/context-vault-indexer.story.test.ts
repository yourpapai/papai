// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import {
  activateOpencodeAdapter,
  type AdapterDeps,
  type SpawnRequest,
} from '../../../../context-vault-indexer/adapters/opencode.js'
import { LOCK_FILE_NAME, type LockFileSystem } from '../../../../context-vault-indexer/lock.js'
import { scenario } from '../../harness/scenario.js'

const LockRecordSchema = z.object({ pid: z.number(), heartbeatAt: z.number() })

const readLockRecord = (stateDir: string): { pid: number; heartbeatAt: number } =>
  LockRecordSchema.parse(JSON.parse(readFileSync(join(stateDir, LOCK_FILE_NAME), 'utf8')))

// A real node:fs LockFileSystem rooted inside the scenario temp root (the only
// tree the sandbox permits writes to), so the two activations contend over a
// real lock file rather than an in-memory fake.
const nodeLockFs = (): LockFileSystem => ({
  readLock: (path: string) => {
    try {
      return readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  createExclusive: (path: string, contents: string) => {
    try {
      writeFileSync(path, contents, { flag: 'wx' })
      return true
    } catch {
      return false
    }
  },
  write: (path: string, contents: string) => {
    writeFileSync(path, contents)
  },
  remove: (path: string) => {
    rmSync(path, { force: true })
  },
})

scenario(
  'SCN-context-vault-indexer-singleton: two plugin activations spawn exactly one daemon through the lock',
  ({ world }) => {
    const stateDir = join(world.tempRoot, 'vault-indexer')
    mkdirSync(stateDir, { recursive: true })
    const fs = nodeLockFs()
    const spawns: SpawnRequest[] = []
    const lockBase = { fs, isPidAlive: (): boolean => true, now: (): number => 100_000, ttlMs: 10_000 }
    const deps = (pid: number): AdapterDeps => ({
      lock: lockBase,
      spawnDetached: (request) => {
        spawns.push(request)
      },
      pid,
    })
    const input = { stateDir, daemonEntry: 'context-vault-indexer/daemon-main.ts' }

    // Two coding-agent plugin sessions activate back to back over one state dir.
    const first = activateOpencodeAdapter(input, deps(1111))
    const second = activateOpencodeAdapter(input, deps(2222))

    expect(first).toBe('spawned')
    expect(second).toBe('already-running')
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.options).toEqual({ detached: true, stdio: 'ignore' })

    const lockOnDisk = readLockRecord(stateDir)
    expect(lockOnDisk.pid).toBe(1111)

    // The daemon dies and its heartbeat expires; the next activation reclaims and spawns.
    const deadLock = { ...lockBase, isPidAlive: (pid: number): boolean => pid !== 1111, now: (): number => 200_000 }
    const third = activateOpencodeAdapter(input, { ...deps(3333), lock: deadLock })

    expect(third).toBe('spawned')
    expect(spawns).toHaveLength(2)
    const reclaimed = readLockRecord(stateDir)
    expect(reclaimed.pid).toBe(3333)
  },
)
