// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { z } from 'zod'

import {
  activateOpencodeAdapter,
  type AdapterDeps,
  type RegisterCall,
  type SpawnRequest,
} from '../../../../context-vault-indexer/adapters/opencode.js'
import type { ConfigFs, IndexerConfig } from '../../../../context-vault-indexer/config.js'
import { handleIpcLine } from '../../../../context-vault-indexer/ipc.js'
import { LOCK_FILE_NAME, type LockFileSystem } from '../../../../context-vault-indexer/lock.js'
import { createRepoRegistry, type RegisterResult } from '../../../../context-vault-indexer/registry.js'
import type { IdentityFs } from '../../../../context-vault-indexer/repo-identity.js'
import { scenario } from '../../harness/scenario.js'

const LockRecordSchema = z.object({ pid: z.number(), heartbeatAt: z.number() })

const RegisterResultSchema = z.union([
  z.object({ ok: z.literal(true), repo: z.string(), action: z.enum(['registered', 'updated', 'unchanged']) }),
  z.object({ ok: z.literal(false), error: z.string() }),
])

const readTextOrNull = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

const readLockRecord = (stateDir: string): { pid: number; heartbeatAt: number } =>
  LockRecordSchema.parse(JSON.parse(readFileSync(join(stateDir, LOCK_FILE_NAME), 'utf8')))

// A real node:fs LockFileSystem rooted inside the scenario temp root (the only
// tree the sandbox permits writes to), so the two activations contend over a
// real lock file rather than an in-memory fake.
const nodeLockFs = (): LockFileSystem => ({
  readLock: readTextOrNull,
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

const nodeConfigFs = (): ConfigFs => ({
  readFile: readTextOrNull,
  writeFile: (path: string, contents: string) => {
    writeFileSync(path, contents)
  },
  rename: (from: string, to: string) => {
    writeFileSync(to, readFileSync(from, 'utf8'))
    rmSync(from, { force: true })
  },
})

const nodeIdentityFs = (): IdentityFs => ({
  statKind: (path: string) => {
    try {
      return statSync(path).isDirectory() ? 'dir' : 'file'
    } catch {
      return null
    }
  },
  readFile: readTextOrNull,
})

const dirExists = (path: string): boolean => {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Lays down a checkout whose `.git` is a real directory, plus its spec dir. */
const makeCheckout = (root: string): string => {
  mkdirSync(join(root, '.git'), { recursive: true })
  const specDir = join(root, 'openspec', 'changes')
  mkdirSync(specDir, { recursive: true })
  return specDir
}

/** Lays down a git worktree of `mainRoot`, the way `git worktree add` does. */
const makeWorktree = (root: string, mainRoot: string, name: string): string => {
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, '.git'), `gitdir: ${join(mainRoot, '.git', 'worktrees', name)}\n`)
  const specDir = join(root, 'openspec', 'changes')
  mkdirSync(specDir, { recursive: true })
  return specDir
}

const BASE_CONFIG: IndexerConfig = {
  pushUrl: 'https://papai.test/api/context-vault/push',
  intervalMs: 30_000,
  repos: [],
}

scenario(
  'SCN-context-vault-indexer-singleton: concurrent sessions share one daemon and register their repos with it',
  async ({ world }) => {
    const stateDir = join(world.tempRoot, 'vault-indexer')
    mkdirSync(stateDir, { recursive: true })

    const papaiSpecDir = makeCheckout(join(world.tempRoot, 'papai'))
    const otherSpecDir = makeCheckout(join(world.tempRoot, 'other'))
    const worktreeSpecDir = makeWorktree(join(world.tempRoot, 'papai-wt'), join(world.tempRoot, 'papai'), 'papai-wt')

    // The daemon's own registry, reached through the real request protocol —
    // only the socket transport is stubbed, because the story sandbox permits
    // no live listeners.
    const registry = createRepoRegistry(BASE_CONFIG, {
      stateDir,
      configFs: nodeConfigFs(),
      identityFs: nodeIdentityFs(),
      dirExists,
    })
    const registerCalls: RegisterCall[] = []
    const registerOverProtocol = (call: RegisterCall): Promise<RegisterResult> => {
      registerCalls.push(call)
      const line = handleIpcLine(JSON.stringify({ op: 'register', repo: call.repo, specDir: call.specDir }), {
        register: (input) => registry.register(input),
        status: () => ({ repos: registry.list(), lastScanAt: registry.lastScanAt() }),
      })
      return Promise.resolve(RegisterResultSchema.parse(JSON.parse(line)))
    }

    const fs = nodeLockFs()
    const spawns: SpawnRequest[] = []
    const lockBase = { fs, isPidAlive: (): boolean => true, now: (): number => 100_000, ttlMs: 10_000 }
    // Each activation's plugin pid is short-lived; the spawned daemon gets its
    // own pid and takes over the lock record via handoff.
    const daemonPidOf = (pluginPid: number): number => pluginPid + 10_000
    const deps = (pid: number): AdapterDeps => ({
      lock: lockBase,
      spawnDetached: (request) => {
        spawns.push(request)
        return daemonPidOf(pid)
      },
      register: registerOverProtocol,
      sleep: () => Promise.resolve(),
      pid,
    })
    const daemonEntry = 'context-vault-indexer/main.ts'

    // Two coding-agent plugin sessions activate back to back over one state
    // dir, each opened on a different repository.
    const first = await activateOpencodeAdapter(
      { stateDir, daemonEntry, repo: 'papai', specDir: papaiSpecDir },
      deps(1111),
    )
    const second = await activateOpencodeAdapter(
      { stateDir, daemonEntry, repo: 'other', specDir: otherSpecDir },
      deps(2222),
    )

    expect(first).toEqual({ daemon: 'spawned', registration: 'registered' })
    expect(spawns).toHaveLength(1)
    expect(spawns[0]?.options).toEqual({ detached: true, stdio: 'ignore' })

    // The second session spawns nothing but is not a no-op: its repo joins the
    // running daemon's watch set.
    expect(second).toEqual({ daemon: 'already-running', registration: 'registered' })
    expect(
      registry
        .list()
        .map((entry) => entry.repo)
        .toSorted(),
    ).toEqual(['other', 'papai'])

    const lockOnDisk = readLockRecord(stateDir)
    expect(lockOnDisk.pid).toBe(daemonPidOf(1111))

    // A session opened on a worktree of an already-registered repo re-points it
    // rather than adding a second entry for the same project.
    const worktreeSession = await activateOpencodeAdapter(
      { stateDir, daemonEntry, repo: 'papai', specDir: worktreeSpecDir },
      deps(4444),
    )

    expect(worktreeSession).toEqual({ daemon: 'already-running', registration: 'updated' })
    expect(registry.list()).toHaveLength(2)
    expect(registry.list().find((entry) => entry.repo === 'papai')?.specDir).toBe(worktreeSpecDir)
    expect(new Set(registry.runtimes().map((entry) => entry.stateKey)).size).toBe(2)

    // The daemon dies and its heartbeat expires; the next activation reclaims and spawns.
    const deadLock = {
      ...lockBase,
      isPidAlive: (pid: number): boolean => pid !== daemonPidOf(1111),
      now: (): number => 200_000,
    }
    const third = await activateOpencodeAdapter(
      { stateDir, daemonEntry, repo: 'papai', specDir: papaiSpecDir },
      { ...deps(3333), lock: deadLock },
    )

    expect(third.daemon).toBe('spawned')
    expect(spawns).toHaveLength(2)
    const reclaimed = readLockRecord(stateDir)
    expect(reclaimed.pid).toBe(daemonPidOf(3333))
    expect(registerCalls.every((call) => call.socketPath.startsWith(stateDir))).toBe(true)
  },
)
