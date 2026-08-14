// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { z } from 'zod'

import {
  runDaemon,
  scanOnce,
  type DaemonConfig,
  type DaemonDeps,
  type DaemonFs,
  type PushCall,
} from '../../context-vault-indexer/daemon.js'
import { LOCK_FILE_NAME, type LockDeps, type LockFileSystem } from '../../context-vault-indexer/lock.js'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

type FakeFile = { text: string; mtime: number }

type FakeDaemonFs = DaemonFs & {
  files: Map<string, FakeFile>
  savedStates: string[]
}

const SPEC_DIR = 'openspec/changes'

const makeFakeFs = (files: Record<string, FakeFile>, state: string | null = null): FakeDaemonFs => {
  const map = new Map<string, FakeFile>(Object.entries(files))
  const savedStates: string[] = []
  let saved = state
  return {
    files: map,
    savedStates,
    listMarkdownFiles: (dir: string) =>
      [...map.keys()]
        .filter((path) => path.startsWith(`${dir}/`) && path.endsWith('.md'))
        .map((path) => path.slice(dir.length + 1))
        .toSorted(),
    readFile: (path: string) => map.get(path)?.text ?? null,
    statMtime: (path: string) => map.get(path)?.mtime ?? 0,
    readState: () => saved,
    writeState: (contents: string) => {
      saved = contents
      savedStates.push(contents)
    },
  }
}

type PushScript = { ok: boolean; status: number }[]

const makeDeps = (
  fs: FakeDaemonFs,
  script: PushScript = [{ ok: true, status: 200 }],
): { deps: DaemonDeps; pushes: PushCall[]; sleeps: number[] } => {
  const pushes: PushCall[] = []
  const sleeps: number[] = []
  let index = 0
  return {
    pushes,
    sleeps,
    deps: {
      fs,
      push: (url: string, bearer: string, body: string) => {
        pushes.push({ url, bearer, body })
        const outcome = script[Math.min(index, script.length - 1)]
        index += 1
        return Promise.resolve(outcome ?? { ok: false, status: 500 })
      },
      sleep: (ms: number) => {
        sleeps.push(ms)
        return Promise.resolve()
      },
      backoffBaseMs: 1_000,
      maxPushAttempts: 3,
    },
  }
}

const CONFIG: DaemonConfig = {
  repo: 'papai',
  specDir: SPEC_DIR,
  pushUrl: 'https://bot.example/api/context-vault/push',
  token: 'cv-token-plaintext',
}

const file = (text: string, mtime: number): FakeFile => ({ text, mtime })

const persistedState = (entries: Record<string, { hash: string; mtime: number }>): string =>
  JSON.stringify({ files: entries })

const SavedStateSchema = z.object({
  files: z.record(z.string(), z.object({ hash: z.string(), mtime: z.number() })),
})

const savedStateAt = (fs: FakeDaemonFs, index: number, fallback: string): string => fs.savedStates[index] ?? fallback

// Fake fs that aborts the controller once listMarkdownFiles has been called `abortAfter` times.
const makeAbortingFs = (controller: AbortController, abortAfter: number): { fs: FakeDaemonFs; scans: () => number } => {
  const base = makeFakeFs({ [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) })
  let scans = 0
  return {
    scans: () => scans,
    fs: {
      ...base,
      listMarkdownFiles: (dir: string) => {
        scans += 1
        if (scans >= abortAfter) controller.abort()
        return base.listMarkdownFiles(dir)
      },
    },
  }
}

const PushBodySchema = z.object({
  repo: z.string(),
  changeName: z.string(),
  files: z.array(z.unknown()),
  deletions: z.array(z.string()),
})

const bodyOf = (call: PushCall): z.infer<typeof PushBodySchema> => PushBodySchema.parse(JSON.parse(call.body))

type FakeLockFs = LockFileSystem & { files: Map<string, string>; writes: string[] }

const makeFakeLockFs = (seed: Record<string, string> = {}): FakeLockFs => {
  const files = new Map<string, string>(Object.entries(seed))
  const writes: string[] = []
  return {
    files,
    writes,
    readLock: (path: string) => files.get(path) ?? null,
    createExclusive: () => false,
    write: (path: string, contents: string) => {
      writes.push(contents)
      files.set(path, contents)
    },
    remove: (path: string) => {
      files.delete(path)
    },
  }
}

const readLockRecordAt = (fs: FakeLockFs, path: string): unknown => JSON.parse(fs.files.get(path) ?? '')

describe('context-vault-indexer daemon scanOnce', () => {
  test('a fresh scan pushes every markdown file grouped by change directory', async () => {
    const fs = makeFakeFs({
      [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n\nbody', 100),
      [`${SPEC_DIR}/alpha/tasks.md`]: file('- [ ] one\n', 101),
      [`${SPEC_DIR}/beta/design.md`]: file('# Beta design\n', 200),
    })
    const { deps, pushes } = makeDeps(fs)

    const result = await scanOnce(CONFIG, deps)

    expect(result).toEqual({ scanned: 3, pushedChanges: 2, failedChanges: 0 })
    expect(pushes).toHaveLength(2)

    const alpha = bodyOf(pushes[0]!)
    expect(alpha.repo).toBe('papai')
    expect(alpha.changeName).toBe('alpha')
    expect(alpha.deletions).toEqual([])
    expect(alpha.files).toEqual([
      {
        path: 'alpha/proposal.md',
        kind: 'proposal',
        hash: sha256('# Alpha\n\nbody'),
        mtime: 100,
        text: '# Alpha\n\nbody',
      },
      { path: 'alpha/tasks.md', kind: 'tasks', hash: sha256('- [ ] one\n'), mtime: 101, text: '- [ ] one\n' },
    ])

    const beta = bodyOf(pushes[1]!)
    expect(beta.changeName).toBe('beta')
    expect(beta.files).toHaveLength(1)
  })

  test('the push carries the bearer token to the configured push URL', async () => {
    const fs = makeFakeFs({ [`${SPEC_DIR}/alpha/proposal.md`]: file('# A\n', 100) })
    const { deps, pushes } = makeDeps(fs)

    await scanOnce(CONFIG, deps)

    expect(pushes[0]?.url).toBe('https://bot.example/api/context-vault/push')
    expect(pushes[0]?.bearer).toBe('cv-token-plaintext')
  })

  test('a scan with an unchanged persisted map pushes nothing and writes no state', async () => {
    const fs = makeFakeFs(
      { [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) },
      persistedState({ 'alpha/proposal.md': { hash: sha256('# Alpha\n'), mtime: 100 } }),
    )
    const { deps, pushes } = makeDeps(fs)

    const result = await scanOnce(CONFIG, deps)

    expect(result).toEqual({ scanned: 1, pushedChanges: 0, failedChanges: 0 })
    expect(pushes).toHaveLength(0)
    expect(fs.savedStates).toHaveLength(0)
  })

  test('a changed file produces a delta payload holding only that file', async () => {
    const fs = makeFakeFs(
      {
        [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha v2\n', 150),
        [`${SPEC_DIR}/alpha/tasks.md`]: file('- [ ] one\n', 101),
      },
      persistedState({
        'alpha/proposal.md': { hash: sha256('# Alpha v1\n'), mtime: 100 },
        'alpha/tasks.md': { hash: sha256('- [ ] one\n'), mtime: 101 },
      }),
    )
    const { deps, pushes } = makeDeps(fs)

    const result = await scanOnce(CONFIG, deps)

    expect(result).toEqual({ scanned: 2, pushedChanges: 1, failedChanges: 0 })
    expect(pushes).toHaveLength(1)
    const body = bodyOf(pushes[0]!)
    expect(body.changeName).toBe('alpha')
    expect(body.files).toEqual([
      { path: 'alpha/proposal.md', kind: 'proposal', hash: sha256('# Alpha v2\n'), mtime: 150, text: '# Alpha v2\n' },
    ])
    expect(body.deletions).toEqual([])
  })

  test('a deleted markdown file is reported in deletions for its change', async () => {
    const fs = makeFakeFs(
      { [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) },
      persistedState({
        'alpha/proposal.md': { hash: sha256('# Alpha\n'), mtime: 100 },
        'alpha/tasks.md': { hash: sha256('- [ ] one\n'), mtime: 101 },
      }),
    )
    const { deps, pushes } = makeDeps(fs)

    await scanOnce(CONFIG, deps)

    expect(pushes).toHaveLength(1)
    const body = bodyOf(pushes[0]!)
    expect(body.changeName).toBe('alpha')
    expect(body.files).toEqual([])
    expect(body.deletions).toEqual(['alpha/tasks.md'])
  })

  test('the persisted hash map survives a restart: the next scan sees no delta', async () => {
    const files = { [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) }
    const firstFs = makeFakeFs(files)
    const first = makeDeps(firstFs)

    await scanOnce(CONFIG, first.deps)

    expect(firstFs.savedStates).toHaveLength(1)
    const savedState = savedStateAt(firstFs, 0, '')

    const secondFs = makeFakeFs(files, savedState)
    const second = makeDeps(secondFs)
    const result = await scanOnce(CONFIG, second.deps)

    expect(result).toEqual({ scanned: 1, pushedChanges: 0, failedChanges: 0 })
    expect(second.pushes).toHaveLength(0)
  })

  test('state persists the new hash map after a successful push', async () => {
    const fs = makeFakeFs({ [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) })
    const { deps } = makeDeps(fs)

    await scanOnce(CONFIG, deps)

    const saved = SavedStateSchema.parse(JSON.parse(savedStateAt(fs, 0, '{}')))
    expect(saved.files['alpha/proposal.md']).toEqual({ hash: sha256('# Alpha\n'), mtime: 100 })
  })

  test('a failed push backs off exponentially, retries, and still persists on eventual success', async () => {
    const fs = makeFakeFs({ [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100) })
    const { deps, pushes, sleeps } = makeDeps(fs, [
      { ok: false, status: 500 },
      { ok: false, status: 502 },
      { ok: true, status: 200 },
    ])

    const result = await scanOnce(CONFIG, deps)

    expect(pushes).toHaveLength(3)
    expect(sleeps).toEqual([1_000, 2_000])
    expect(result).toEqual({ scanned: 1, pushedChanges: 1, failedChanges: 0 })
    expect(fs.savedStates).toHaveLength(1)
  })

  test('a change whose push keeps failing is not persisted and reports as failed', async () => {
    const fs = makeFakeFs({
      [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100),
      [`${SPEC_DIR}/beta/proposal.md`]: file('# Beta\n', 200),
    })
    const { deps, sleeps } = makeDeps(fs, [{ ok: false, status: 500 }])

    const result = await scanOnce(CONFIG, deps)

    expect(result).toEqual({ scanned: 2, pushedChanges: 0, failedChanges: 2 })
    expect(sleeps).toEqual([1_000, 2_000, 1_000, 2_000])
    expect(fs.savedStates).toHaveLength(0)
  })

  test('non-markdown files and root-level files are ignored', async () => {
    const fs = makeFakeFs({
      [`${SPEC_DIR}/alpha/proposal.md`]: file('# Alpha\n', 100),
    })
    fs.files.set(`${SPEC_DIR}/alpha/notes.txt`, file('plain text', 100))
    fs.files.set(`${SPEC_DIR}/toplevel.md`, file('# top\n', 100))
    const { deps, pushes } = makeDeps(fs)

    const result = await scanOnce(CONFIG, deps)

    expect(result.scanned).toBe(1)
    expect(pushes).toHaveLength(1)
    expect(bodyOf(pushes[0]!).changeName).toBe('alpha')
  })
})

describe('runDaemon', () => {
  test('rescans on each interval tick until the abort signal fires', async () => {
    const controller = new AbortController()
    const { fs, scans } = makeAbortingFs(controller, 2)
    const { deps, pushes, sleeps } = makeDeps(fs)

    await runDaemon(CONFIG, deps, { intervalMs: 5_000, signal: controller.signal })

    expect(scans()).toBe(2)
    expect(pushes).toHaveLength(1)
    expect(sleeps).toEqual([5_000])
  })

  test('refreshes the lock heartbeat under its own pid on every tick', async () => {
    const LOCK_PATH = `/state/${LOCK_FILE_NAME}`
    const lockFs = makeFakeLockFs({ [LOCK_PATH]: JSON.stringify({ pid: 5555, heartbeatAt: 0 }) })
    let clock = 100_000
    const heartbeats: number[] = []
    const countingLockFs: LockFileSystem = {
      ...lockFs,
      write: (path: string, contents: string) => {
        heartbeats.push(clock)
        lockFs.write(path, contents)
      },
    }
    const lock: LockDeps = { fs: countingLockFs, isPidAlive: () => true, now: () => clock, ttlMs: 10_000 }

    const controller = new AbortController()
    const { fs, scans } = makeAbortingFs(controller, 2)
    const base = makeDeps(fs)
    const sleepAndAdvance = (ms: number): Promise<void> => {
      clock += ms
      return base.deps.sleep(ms)
    }
    const deps: DaemonDeps = {
      ...base.deps,
      sleep: sleepAndAdvance,
      heartbeat: { lockPath: LOCK_PATH, pid: 5555, lock },
    }

    await runDaemon(CONFIG, deps, { intervalMs: 5_000, signal: controller.signal })

    expect(scans()).toBe(2)
    expect(heartbeats).toEqual([100_000, 105_000])
    expect(readLockRecordAt(lockFs, LOCK_PATH)).toEqual({ pid: 5555, heartbeatAt: 105_000 })
  })

  test('does not touch a lock held by another pid', async () => {
    const LOCK_PATH = `/state/${LOCK_FILE_NAME}`
    const foreign = JSON.stringify({ pid: 1111, heartbeatAt: 0 })
    const lockFs = makeFakeLockFs({ [LOCK_PATH]: foreign })
    const lock: LockDeps = { fs: lockFs, isPidAlive: () => true, now: () => 100_000, ttlMs: 10_000 }

    const controller = new AbortController()
    const { fs } = makeAbortingFs(controller, 1)
    const base = makeDeps(fs)
    const deps: DaemonDeps = { ...base.deps, heartbeat: { lockPath: LOCK_PATH, pid: 5555, lock } }

    await runDaemon(CONFIG, deps, { intervalMs: 5_000, signal: controller.signal })

    expect(lockFs.files.get(LOCK_PATH)).toBe(foreign)
  })
})
