// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CONFIG_FILE_NAME, readConfig, type ConfigFs, type IndexerConfig } from '../../context-vault-indexer/config.js'
import {
  createRepoRegistry,
  type RegisterResult,
  type RegistryDeps,
  type RepoRuntimeEntry,
} from '../../context-vault-indexer/registry.js'
import type { IdentityFs } from '../../context-vault-indexer/repo-identity.js'

const STATE_DIR = '/state'
const CONFIG_PATH = `${STATE_DIR}/${CONFIG_FILE_NAME}`

const BASE: IndexerConfig = {
  pushUrl: 'https://papai.example/api/context-vault/push',
  intervalMs: 30_000,
  repos: [],
}

type Harness = { deps: RegistryDeps; files: Map<string, string> }

// Values are file contents; the literal 'dir' marks a real directory.
const makeHarness = (options: { gitTree?: Record<string, string>; dirs?: string[] } = {}): Harness => {
  const gitTree = options.gitTree ?? {}
  const dirs = new Set(options.dirs ?? [])
  const files = new Map<string, string>()
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
  const identityFs: IdentityFs = {
    statKind: (path) => {
      const entry = gitTree[path]
      if (entry === undefined) return null
      return entry === 'dir' ? 'dir' : 'file'
    },
    readFile: (path) => {
      const entry = gitTree[path]
      return entry === undefined || entry === 'dir' ? null : entry
    },
  }
  return { files, deps: { stateDir: STATE_DIR, configFs, identityFs, dirExists: (path) => dirs.has(path) } }
}

/** Narrowing helpers: the lint rule keeps branches out of test bodies. */
const firstStateKey = (registry: ReturnType<typeof createRepoRegistry>): string => {
  const first = registry.runtimes()[0]
  if (first === undefined) throw new Error('expected at least one registered repo')
  return first.stateKey
}

const firstRuntime = (registry: ReturnType<typeof createRepoRegistry>): RepoRuntimeEntry => {
  const first = registry.runtimes()[0]
  if (first === undefined) throw new Error('expected at least one registered repo')
  return first
}

const registerErrorOf = (result: RegisterResult): string => {
  if (result.ok) throw new Error('expected a registration failure')
  return result.error
}

const configOf = (result: ReturnType<typeof readConfig>): IndexerConfig => {
  if (!result.ok) throw new Error(`expected a parsed config, got: ${result.error}`)
  return result.config
}

const REPO_GIT: Record<string, string> = { '/home/u/papai/.git': 'dir' }
const WORKTREE_GIT: Record<string, string> = {
  ...REPO_GIT,
  '/home/u/wt-a/.git': 'gitdir: /home/u/papai/.git/worktrees/wt-a',
  '/home/u/wt-b/.git': 'gitdir: /home/u/papai/.git/worktrees/wt-b',
}

describe('createRepoRegistry', () => {
  test('registers a repo it has not seen', () => {
    const { deps, files } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    const registry = createRepoRegistry(BASE, deps)

    const result = registry.register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })

    expect(result).toEqual({ ok: true, repo: 'papai', action: 'registered' })
    expect(registry.list()).toEqual([{ repo: 'papai', specDir: '/home/u/papai/openspec/changes' }])
    expect(files.get(CONFIG_PATH)).toContain('/home/u/papai/openspec/changes')
  })

  test('an identical re-register is unchanged, does not duplicate, and keeps the scan state key', () => {
    const { deps } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    const registry = createRepoRegistry(BASE, deps)
    const input = { repo: 'papai', specDir: '/home/u/papai/openspec/changes' }

    registry.register(input)
    const before = firstStateKey(registry)
    const result = registry.register(input)

    expect(result).toEqual({ ok: true, repo: 'papai', action: 'unchanged' })
    expect(registry.list()).toHaveLength(1)
    expect(firstStateKey(registry)).toBe(before)
  })

  test('a second worktree re-points the same repo instead of adding an entry', () => {
    const { deps } = makeHarness({
      gitTree: WORKTREE_GIT,
      dirs: ['/home/u/wt-a/openspec/changes', '/home/u/wt-b/openspec/changes'],
    })
    const registry = createRepoRegistry(BASE, deps)

    registry.register({ repo: 'papai', specDir: '/home/u/wt-a/openspec/changes' })
    const keyBefore = firstStateKey(registry)
    const result = registry.register({ repo: 'papai', specDir: '/home/u/wt-b/openspec/changes' })

    expect(result).toEqual({ ok: true, repo: 'papai', action: 'updated' })
    expect(registry.list()).toEqual([{ repo: 'papai', specDir: '/home/u/wt-b/openspec/changes' }])
    expect(firstStateKey(registry)).toBe(keyBefore)
  })

  test('the main checkout and a worktree of it collapse to one entry', () => {
    const { deps } = makeHarness({
      gitTree: WORKTREE_GIT,
      dirs: ['/home/u/papai/openspec/changes', '/home/u/wt-a/openspec/changes'],
    })
    const registry = createRepoRegistry(BASE, deps)

    registry.register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })
    registry.register({ repo: 'papai', specDir: '/home/u/wt-a/openspec/changes' })

    expect(registry.list()).toHaveLength(1)
  })

  test('distinct repositories are watched independently with distinct state keys', () => {
    const { deps } = makeHarness({
      gitTree: { '/home/u/papai/.git': 'dir', '/home/u/other/.git': 'dir' },
      dirs: ['/home/u/papai/openspec/changes', '/home/u/other/openspec/changes'],
    })
    const registry = createRepoRegistry(BASE, deps)

    registry.register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })
    registry.register({ repo: 'other', specDir: '/home/u/other/openspec/changes' })

    expect(registry.list()).toHaveLength(2)
    const keys = registry.runtimes().map((entry) => entry.stateKey)
    expect(new Set(keys).size).toBe(2)
  })

  test('rejects a spec dir that does not exist and leaves the repo set unchanged', () => {
    const { deps, files } = makeHarness({ gitTree: REPO_GIT, dirs: [] })
    const registry = createRepoRegistry(BASE, deps)

    const result = registry.register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })

    expect(registerErrorOf(result)).toContain('/home/u/papai/openspec/changes')
    expect(registry.list()).toEqual([])
    expect(files.get(CONFIG_PATH)).toBeUndefined()
  })

  test('rehydrates persisted repos so a restart needs no re-registration', () => {
    const { deps } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    const persisted: IndexerConfig = {
      ...BASE,
      repos: [{ repo: 'papai', specDir: '/home/u/papai/openspec/changes' }],
    }

    const registry = createRepoRegistry(persisted, deps)

    expect(registry.list()).toEqual(persisted.repos)
    expect(registry.runtimes()).toHaveLength(1)
  })

  test('collapses duplicate persisted entries that resolve to one identity', () => {
    const { deps } = makeHarness({
      gitTree: WORKTREE_GIT,
      dirs: ['/home/u/wt-a/openspec/changes', '/home/u/wt-b/openspec/changes'],
    })
    const persisted: IndexerConfig = {
      ...BASE,
      repos: [
        { repo: 'papai', specDir: '/home/u/wt-a/openspec/changes' },
        { repo: 'papai', specDir: '/home/u/wt-b/openspec/changes' },
      ],
    }

    const registry = createRepoRegistry(persisted, deps)

    expect(registry.list()).toHaveLength(1)
  })

  test('runtimes carry the push settings from the config', () => {
    const { deps } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    const registry = createRepoRegistry(BASE, deps)
    registry.register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })

    const runtime = firstRuntime(registry)

    expect(runtime.repo).toBe('papai')
    expect(runtime.specDir).toBe('/home/u/papai/openspec/changes')
    expect(runtime.identity).toBe('/home/u/papai')
  })

  test('a registration survives a restart through the config file', () => {
    const { deps } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    createRepoRegistry(BASE, deps).register({ repo: 'papai', specDir: '/home/u/papai/openspec/changes' })

    const restarted = createRepoRegistry(configOf(readConfig(STATE_DIR, deps.configFs)), deps)

    expect(restarted.list()).toEqual([{ repo: 'papai', specDir: '/home/u/papai/openspec/changes' }])
    expect(firstStateKey(restarted)).toBeTruthy()
  })

  test('tracks the last scan time for status reporting', () => {
    const { deps } = makeHarness({ gitTree: REPO_GIT, dirs: ['/home/u/papai/openspec/changes'] })
    const registry = createRepoRegistry(BASE, deps)

    expect(registry.lastScanAt()).toBeNull()
    registry.markScan(1_700_000_000_000)

    expect(registry.lastScanAt()).toBe(1_700_000_000_000)
  })
})
