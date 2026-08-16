// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { CONFIG_FILE_NAME, type ConfigFs, type IndexerConfig } from '../../context-vault-indexer/config.js'
import type { DaemonFs } from '../../context-vault-indexer/daemon.js'
import { startIndexer, type EntryDeps } from '../../context-vault-indexer/entry.js'
import { SOCKET_FILE_NAME, type IpcHandler, type IpcServer } from '../../context-vault-indexer/ipc.js'
import { LOCK_FILE_NAME, type LockDeps, type LockFileSystem } from '../../context-vault-indexer/lock.js'
import type { RepoRuntime, RunDaemonOptions } from '../../context-vault-indexer/loop.js'
import type { IdentityFs } from '../../context-vault-indexer/repo-identity.js'

const STATE_DIR = '/state'
const CONFIG_PATH = `${STATE_DIR}/${CONFIG_FILE_NAME}`
const LOCK_PATH = `${STATE_DIR}/${LOCK_FILE_NAME}`
const SOCKET_PATH = `${STATE_DIR}/${SOCKET_FILE_NAME}`
const OUR_PID = 5555

const VALID_CONFIG: IndexerConfig = {
  pushUrl: 'https://papai.example/api/context-vault/push',
  intervalMs: 30_000,
  repos: [
    { repo: 'papai', specDir: '/home/u/papai/openspec/changes' },
    { repo: 'other', specDir: '/home/u/other/openspec/changes' },
  ],
}

type Harness = {
  deps: EntryDeps
  files: Map<string, string>
  lockFiles: Map<string, string>
  events: string[]
  loops: { repos: readonly RepoRuntime[]; options: RunDaemonOptions }[]
  servers: { socketPath: string; closed: boolean; handler: IpcHandler }[]
  fireSignal: () => void
  stateDirsCreated: string[]
  lockWhileRunning: () => string | null
}

/** Narrowing helpers: the lint rule keeps branches out of test bodies. */
const errorOf = (result: { error?: string }): string => result.error ?? ''

const firstLoop = (harness: Harness): { repos: readonly RepoRuntime[]; options: RunDaemonOptions } => {
  const loop = harness.loops[0]
  if (loop === undefined) throw new Error('expected the scan loop to have started')
  return loop
}

const firstServer = (harness: Harness): { socketPath: string; closed: boolean; handler: IpcHandler } => {
  const server = harness.servers[0]
  if (server === undefined) throw new Error('expected the ipc server to have started')
  return server
}

const LockRecordSchema = z.object({ pid: z.number(), heartbeatAt: z.number() })

const lockRecord = (raw: string | null | undefined): z.infer<typeof LockRecordSchema> => {
  if (raw === undefined || raw === null) throw new Error('expected a lock record')
  return LockRecordSchema.parse(JSON.parse(raw))
}

const makeHarness = (
  options: { configText?: string | null; env?: Record<string, string | undefined>; lockSeed?: string } = {},
): Harness => {
  const files = new Map<string, string>()
  if (options.configText !== null) {
    files.set(CONFIG_PATH, options.configText ?? JSON.stringify(VALID_CONFIG))
  }
  const lockFiles = new Map<string, string>()
  if (options.lockSeed !== undefined) lockFiles.set(LOCK_PATH, options.lockSeed)

  const events: string[] = []
  const loops: Harness['loops'] = []
  const servers: Harness['servers'] = []
  const stateDirsCreated: string[] = []
  let signalHandler: (() => void) | null = null
  // The lock is released on shutdown, so ownership is asserted from a snapshot
  // taken while the daemon is up rather than after it exits.
  let lockSnapshot: string | null = null

  const configFs: ConfigFs = {
    readFile: (path) => files.get(path) ?? null,
    writeFile: (path, contents) => {
      files.set(path, contents)
    },
    rename: (from, to) => {
      const contents = files.get(from)
      if (contents === undefined) throw new Error(`missing ${from}`)
      files.delete(from)
      files.set(to, contents)
    },
  }
  const lockFs: LockFileSystem = {
    readLock: (path) => lockFiles.get(path) ?? null,
    createExclusive: (path, contents) => {
      if (lockFiles.has(path)) return false
      lockFiles.set(path, contents)
      return true
    },
    write: (path, contents) => {
      lockFiles.set(path, contents)
    },
    remove: (path) => {
      lockFiles.delete(path)
    },
  }
  const identityFs: IdentityFs = { statKind: () => null, readFile: () => null }
  const lock: LockDeps = { fs: lockFs, isPidAlive: () => true, now: () => 100_000, ttlMs: 10_000 }
  const daemonFs = (): DaemonFs => ({
    listMarkdownFiles: () => [],
    readFile: () => null,
    statMtime: () => 0,
    readState: () => null,
    writeState: () => undefined,
  })

  return {
    files,
    lockFiles,
    events,
    loops,
    servers,
    stateDirsCreated,
    fireSignal: () => signalHandler?.(),
    lockWhileRunning: () => lockSnapshot,
    deps: {
      env: options.env ?? { CONTEXT_VAULT_TOKEN: 'env-token' },
      pid: OUR_PID,
      now: () => 1_700_000_000_000,
      configFs,
      identityFs,
      lock,
      dirExists: () => true,
      ensureStateDir: (dir: string) => {
        stateDirsCreated.push(dir)
      },
      makeDaemonFs: () => daemonFs(),
      startServer: (socketPath: string, handler: IpcHandler): Promise<IpcServer> => {
        const record = { socketPath, closed: false, handler }
        servers.push(record)
        lockSnapshot = lockFiles.get(LOCK_PATH) ?? null
        return Promise.resolve({
          close: () => {
            record.closed = true
          },
        })
      },
      runLoop: (getRepos, _loopDeps, loopOptions) => {
        loops.push({ repos: getRepos(), options: loopOptions })
        return new Promise<void>((resolve) => {
          // Mirrors runDaemon: an already-aborted signal resolves on the first
          // tick check rather than waiting for an event that already fired.
          if (loopOptions.signal.aborted) {
            resolve()
            return
          }
          loopOptions.signal.addEventListener('abort', () => resolve(), { once: true })
        })
      },
      push: () => Promise.resolve({ ok: true, status: 200 }),
      sleep: () => Promise.resolve(),
      onSignal: (handler: () => void) => {
        signalHandler = handler
      },
      log: (message: string) => {
        events.push(message)
      },
    },
  }
}

describe('startIndexer', () => {
  test('exits non-zero without pushing when the token is missing', async () => {
    const harness = makeHarness({ env: {} })

    const result = await startIndexer(STATE_DIR, harness.deps)

    expect(result.code).toBe(1)
    expect(result.error).toContain('CONTEXT_VAULT_TOKEN')
    expect(harness.loops).toEqual([])
    expect(harness.servers).toEqual([])
  })

  test('exits non-zero naming the file when the config is malformed', async () => {
    const harness = makeHarness({ configText: '{not json' })

    const result = await startIndexer(STATE_DIR, harness.deps)

    expect(result.code).toBe(1)
    expect(result.error).toContain(CONFIG_PATH)
    expect(harness.loops).toEqual([])
  })

  test('exits non-zero naming the file when the config is absent', async () => {
    const harness = makeHarness({ configText: null })

    const result = await startIndexer(STATE_DIR, harness.deps)

    expect(result.code).toBe(1)
    expect(result.error).toContain(CONFIG_PATH)
  })

  test('never echoes the token in a diagnostic', async () => {
    const harness = makeHarness({ configText: '{not json', env: { CONTEXT_VAULT_TOKEN: 'super-secret' } })

    const result = await startIndexer(STATE_DIR, harness.deps)

    expect(errorOf(result)).not.toContain('super-secret')
    expect(harness.events.join(' ')).not.toContain('super-secret')
  })

  test('creates the state directory before touching anything inside it', async () => {
    const harness = makeHarness()
    const started = startIndexer(STATE_DIR, harness.deps)
    harness.fireSignal()
    await started

    expect(harness.stateDirsCreated).toEqual([STATE_DIR])
  })

  test('acquires the lock, binds the socket, and loops over every configured repo', async () => {
    const harness = makeHarness()

    const started = startIndexer(STATE_DIR, harness.deps)
    harness.fireSignal()
    const result = await started

    expect(result.code).toBe(0)
    expect(lockRecord(harness.lockWhileRunning())).toMatchObject({ pid: OUR_PID })
    expect(firstServer(harness).socketPath).toBe(SOCKET_PATH)
    expect(firstLoop(harness).repos.map((entry) => entry.config.repo)).toEqual(['papai', 'other'])
  })

  test('adopts a lock the adapter already handed to this pid instead of exiting', async () => {
    const harness = makeHarness({ lockSeed: JSON.stringify({ pid: OUR_PID, heartbeatAt: 99_000 }) })

    const started = startIndexer(STATE_DIR, harness.deps)
    harness.fireSignal()
    const result = await started

    expect(result.code).toBe(0)
    expect(harness.loops).toHaveLength(1)
  })

  test('stands down without error when another live daemon holds the lock', async () => {
    const harness = makeHarness({ lockSeed: JSON.stringify({ pid: 1111, heartbeatAt: 99_000 }) })

    const result = await startIndexer(STATE_DIR, harness.deps)

    expect(result.code).toBe(0)
    expect(result.error).toBeUndefined()
    expect(harness.loops).toEqual([])
    expect(harness.servers).toEqual([])
    expect(harness.lockFiles.get(LOCK_PATH)).toBe(JSON.stringify({ pid: 1111, heartbeatAt: 99_000 }))
  })

  test('passes the config push settings and env token into every repo runtime', async () => {
    const harness = makeHarness()

    const started = startIndexer(STATE_DIR, harness.deps)
    harness.fireSignal()
    await started

    for (const repo of firstLoop(harness).repos) {
      expect(repo.config.pushUrl).toBe(VALID_CONFIG.pushUrl)
      expect(repo.config.token).toBe('env-token')
    }
  })

  test('serves registrations through the running registry', async () => {
    const harness = makeHarness()
    const started = startIndexer(STATE_DIR, harness.deps)
    const handler = firstServer(harness).handler

    const registered = handler.register({ repo: 'third', specDir: '/home/u/third/openspec/changes' })
    harness.fireSignal()
    await started

    expect(registered).toMatchObject({ ok: true, action: 'registered' })
    expect(handler.status().repos.map((entry) => entry.repo)).toContain('third')
  })

  test('SIGTERM aborts the loop, closes the socket, and releases our lock', async () => {
    const harness = makeHarness()

    const started = startIndexer(STATE_DIR, harness.deps)
    harness.fireSignal()
    const result = await started

    expect(result.code).toBe(0)
    expect(firstLoop(harness).options.signal.aborted).toBe(true)
    expect(firstServer(harness).closed).toBe(true)
    expect(harness.lockFiles.has(LOCK_PATH)).toBe(false)
  })

  test('leaves a lock reclaimed by a replacement daemon in place on shutdown', async () => {
    const harness = makeHarness()

    const started = startIndexer(STATE_DIR, harness.deps)
    // A replacement daemon reclaims the lock while we are running.
    harness.lockFiles.set(LOCK_PATH, JSON.stringify({ pid: 9999, heartbeatAt: 120_000 }))
    harness.fireSignal()
    await started

    expect(lockRecord(harness.lockFiles.get(LOCK_PATH))).toMatchObject({ pid: 9999 })
  })
})
