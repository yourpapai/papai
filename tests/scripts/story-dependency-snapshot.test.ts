// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import type { Stats } from 'node:fs'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { lstat, open as openFile, type FileHandle } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { acquireStoryDependencySnapshot } from '../../scripts/story-dependency-snapshot.js'
import type { StoryDependencyInstallerOptions } from '../../scripts/story-dependency-snapshot.js'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeRemovable(root)
    rmSync(root, { recursive: true, force: true })
  }
})

function makeRemovable(root: string): void {
  if (!statSync(root).isDirectory()) return
  for (const entry of readdirSync(root)) makeRemovable(path.join(root, entry))
  chmodSync(root, 0o700)
}

function fixture(): Readonly<{ projectRoot: string; cacheRoot: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-dependencies-'))
  roots.push(root)
  const projectRoot = path.join(root, 'project')
  writeFileSync(path.join(root, 'package.json'), '{"name":"snapshot-fixture"}\n')
  mkdirSync(projectRoot)
  writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"snapshot-fixture"}\n')
  writeFileSync(path.join(projectRoot, 'bun.lock'), '{"lockfileVersion":1}\n')
  return { projectRoot, cacheRoot: path.join(root, 'cache') }
}

function installer(calls: string[]): (options: StoryDependencyInstallerOptions) => Promise<void> {
  return (options): Promise<void> => {
    calls.push(`${options.cwd}:${options.args.join(' ')}`)
    mkdirSync(path.join(options.cwd, 'node_modules/example'), { recursive: true })
    writeFileSync(path.join(options.cwd, 'node_modules/example/index.js'), 'export default 1\n')
    return Promise.resolve()
  }
}

function mappedAction<K, T>(actions: ReadonlyMap<K, T>, key: K, fallback: T): T {
  return actions.get(key) ?? fallback
}

function capturedInstallerOptions(value: StoryDependencyInstallerOptions | undefined): StoryDependencyInstallerOptions {
  if (value === undefined) throw new Error('Installer configuration was not captured')
  return value
}

function installerEnvironment(cwd: string): Readonly<Record<string, string>> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: path.join(cwd, '.home'),
    TMPDIR: path.join(cwd, '.tmp'),
    BUN_INSTALL_CACHE_DIR: path.join(cwd, '.bun-cache'),
  }
}

function sequentialOpen(): (target: string, flags: number) => Promise<FileHandle> {
  let reading = false
  return async (target, flags): Promise<FileHandle> => {
    const handle = await openFile(target, flags)
    const readFile = handle.readFile.bind(handle)
    Object.defineProperty(handle, 'readFile', {
      value: async (): Promise<Uint8Array> => {
        if (reading) throw new Error('A second dependency file was read before the first was hashed')
        reading = true
        await Promise.resolve()
        try {
          return await readFile()
        } finally {
          reading = false
        }
      },
    })
    return handle
  }
}

describe('story dependency snapshot', () => {
  test('keys package bytes, lock bytes, and the exact Bun version', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const calls: string[] = []
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }

    const first = await acquireStoryDependencySnapshot(options, { install: installer(calls) })
    writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"changed"}\n')
    const packageChanged = await acquireStoryDependencySnapshot(options, { install: installer(calls) })
    writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"snapshot-fixture"}\n')
    writeFileSync(path.join(projectRoot, 'bun.lock'), '{"lockfileVersion":2}\n')
    const lockChanged = await acquireStoryDependencySnapshot(options, { install: installer(calls) })
    const versionChanged = await acquireStoryDependencySnapshot(
      { ...options, bunVersion: '1.2.4' },
      { install: installer(calls) },
    )

    expect(new Set([first.key, packageChanged.key, lockChanged.key, versionChanged.key]).size).toBe(4)
  })

  test('validates a cache hit without invoking the installer', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const calls: string[] = []
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }
    const first = await acquireStoryDependencySnapshot(options, { install: installer(calls) })

    const repeated = await acquireStoryDependencySnapshot(options, {
      install: (): Promise<void> => Promise.reject(new Error('installer must not run for a cache hit')),
    })

    expect(repeated).toEqual(first)
    expect(calls).toHaveLength(1)
  })

  test('hashes dependency files sequentially with an insertion-order-independent tree hash', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }
    const install =
      (names: readonly string[]) =>
      (installerOptions: StoryDependencyInstallerOptions): Promise<void> => {
        const dependencies = path.join(installerOptions.cwd, 'node_modules/example')
        mkdirSync(dependencies, { recursive: true })
        for (const name of names) writeFileSync(path.join(dependencies, name), `export default '${name}'\n`)
        return Promise.resolve()
      }
    const first = await acquireStoryDependencySnapshot(options, {
      install: install(['zeta.js', 'alpha.js']),
      open: sequentialOpen(),
    })
    writeFileSync(path.join(projectRoot, 'bun.lock'), '{"lockfileVersion":2}\n')
    const second = await acquireStoryDependencySnapshot(options, {
      install: install(['alpha.js', 'zeta.js']),
      open: sequentialOpen(),
    })

    expect(first.treeHash).toBe('06338d1806b54c38d7b2e646e32e655579285600b366a32afa773c9cf86c6145')
    expect(second.treeHash).toBe(first.treeHash)
  })

  test('rejects a corrupt cache entry instead of installing over it', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }
    const snapshot = await acquireStoryDependencySnapshot(options, { install: installer([]) })
    chmodSync(path.join(snapshot.root, 'example'), 0o755)
    chmodSync(path.join(snapshot.root, 'example/index.js'), 0o644)
    writeFileSync(path.join(snapshot.root, 'example/index.js'), 'corrupt\n')

    await expect(
      acquireStoryDependencySnapshot(options, {
        install: (): Promise<void> => Promise.reject(new Error('installer must not run for a corrupt entry')),
      }),
    ).rejects.toThrow('Story dependency cache entry is invalid')
  })

  test('rejects a dependency symlink that escapes node_modules', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }

    await expect(
      acquireStoryDependencySnapshot(options, {
        install: (installerOptions): Promise<void> => {
          mkdirSync(path.join(installerOptions.cwd, 'node_modules'), { recursive: true })
          symlinkSync('../../outside', path.join(installerOptions.cwd, 'node_modules/escape'))
          return Promise.resolve()
        },
      }),
    ).rejects.toThrow('Unsafe story dependency symlink')
  })

  test('acquires and verifies a dependency symlink that stays inside node_modules', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }

    const snapshot = await acquireStoryDependencySnapshot(options, {
      install: (installerOptions): Promise<void> => {
        const dependencies = path.join(installerOptions.cwd, 'node_modules/example')
        mkdirSync(dependencies, { recursive: true })
        writeFileSync(path.join(dependencies, 'target.js'), 'export default 1\n')
        symlinkSync('target.js', path.join(dependencies, 'internal-link.js'))
        return Promise.resolve()
      },
    })

    await expect(
      acquireStoryDependencySnapshot(options, {
        install: (): Promise<void> => Promise.reject(new Error('installer must not run for a cache hit')),
      }),
    ).resolves.toEqual(snapshot)
  })

  test('does not publish an entry when staging seal fails', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const normalChmod = (target: string, mode: number): Promise<void> => {
      chmodSync(target, mode)
      return Promise.resolve()
    }
    const failingChmod = (): Promise<void> => Promise.reject(new Error('seal failed'))
    const chmodByMode = new Map<number, typeof normalChmod>([[0o500, failingChmod]])

    await expect(
      acquireStoryDependencySnapshot(
        { projectRoot, cacheRoot, bunVersion: '1.2.3' },
        {
          install: installer([]),
          chmod: (target, mode): Promise<void> => mappedAction(chmodByMode, mode, normalChmod)(target, mode),
        },
      ),
    ).rejects.toThrow('seal failed')

    expect(readdirSync(cacheRoot)).toEqual([])
  })

  test('does not publish an entry when private verification fails after sealing', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const normalChmod = (target: string, mode: number): Promise<void> => {
      chmodSync(target, mode)
      return Promise.resolve()
    }
    const corruptFirstSealedDirectory = (target: string): Promise<void> => {
      const dependencyFile = path.join(target, 'index.js')
      chmodSync(target, 0o755)
      chmodSync(dependencyFile, 0o644)
      writeFileSync(dependencyFile, 'corrupt\n')
      chmodSync(dependencyFile, 0o444)
      chmodSync(target, 0o500)
      return Promise.resolve()
    }
    const chmodByMode = new Map<number, typeof normalChmod>([[0o500, corruptFirstSealedDirectory]])
    const chmod = (target: string, mode: number): Promise<void> => {
      const action = mappedAction(chmodByMode, mode, normalChmod)
      chmodByMode.delete(mode)
      return action(target, mode)
    }

    await expect(
      acquireStoryDependencySnapshot(
        { projectRoot, cacheRoot, bunVersion: '1.2.3' },
        {
          install: installer([]),
          chmod,
        },
      ),
    ).rejects.toThrow('Story dependency cache entry is invalid')

    expect(readdirSync(cacheRoot)).toEqual([])
  })

  test('verifies an existing winner when atomic publication races', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }
    const winner = await acquireStoryDependencySnapshot(options, { install: installer([]) })
    const winnerRoot = path.join(cacheRoot, winner.key)
    const readActual = (target: string): Promise<Stats> => lstat(target)
    const missingWinner = (): Promise<Stats> =>
      Promise.reject(Object.assign(new Error('missing before publish'), { code: 'ENOENT' }))
    const lstatByTarget = new Map<string, typeof readActual>([[winnerRoot, missingWinner]])
    const readSnapshotEntry = (target: string): Promise<Stats> => {
      const action = mappedAction(lstatByTarget, target, readActual)
      lstatByTarget.delete(target)
      return action(target)
    }

    const result = await acquireStoryDependencySnapshot(options, {
      install: installer([]),
      lstat: readSnapshotEntry,
      rename: (): Promise<void> => Promise.reject(Object.assign(new Error('already published'), { code: 'EEXIST' })),
    })

    expect(result).toEqual(winner)
    expect(existsSync(winnerRoot)).toBe(true)
    expect(readdirSync(cacheRoot)).toEqual([winner.key])
  })

  test('rejects a symlinked cache root before installing dependencies', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const external = path.join(path.dirname(cacheRoot), 'external-cache')
    mkdirSync(external)
    symlinkSync(external, cacheRoot)

    await expect(
      acquireStoryDependencySnapshot(
        { projectRoot, cacheRoot, bunVersion: '1.2.3' },
        { install: (): Promise<void> => Promise.reject(new Error('installer must not run')) },
      ),
    ).rejects.toThrow('Unsafe story dependency cache root')
  })

  test('rejects an existing cache root with group-readable permissions', async () => {
    const { projectRoot, cacheRoot } = fixture()
    mkdirSync(cacheRoot)
    chmodSync(cacheRoot, 0o755)

    await expect(
      acquireStoryDependencySnapshot(
        { projectRoot, cacheRoot, bunVersion: '1.2.3' },
        { install: (): Promise<void> => Promise.reject(new Error('installer must not run')) },
      ),
    ).rejects.toThrow('Unsafe story dependency cache root')
  })

  test('rejects a writable cache entry whose bytes still match its manifest', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const options = { projectRoot, cacheRoot, bunVersion: '1.2.3' }
    const snapshot = await acquireStoryDependencySnapshot(options, { install: installer([]) })
    chmodSync(path.join(snapshot.root, 'example'), 0o755)

    await expect(
      acquireStoryDependencySnapshot(options, {
        install: (): Promise<void> => Promise.reject(new Error('installer must not run for a cache hit')),
      }),
    ).rejects.toThrow('Story dependency cache entry is invalid')
  })

  test('seals executable dependency files without removing the owner execute bit', async () => {
    const { projectRoot, cacheRoot } = fixture()
    const snapshot = await acquireStoryDependencySnapshot(
      { projectRoot, cacheRoot, bunVersion: '1.2.3' },
      {
        install: (options): Promise<void> => {
          const executable = path.join(options.cwd, 'node_modules/example/bin/tool')
          mkdirSync(path.dirname(executable), { recursive: true })
          writeFileSync(executable, '#!/bin/sh\n')
          chmodSync(executable, 0o755)
          return Promise.resolve()
        },
      },
    )

    expect(statSync(path.join(snapshot.root, 'example/bin/tool')).mode & 0o777).toBe(0o500)
    expect(statSync(snapshot.root).mode & 0o777).toBe(0o500)
  })

  test('passes the installer a secret-free isolated process configuration', async () => {
    const { projectRoot, cacheRoot } = fixture()
    let received: StoryDependencyInstallerOptions | undefined

    await acquireStoryDependencySnapshot(
      { projectRoot, cacheRoot, bunVersion: '1.2.3' },
      {
        install: (options): Promise<void> => {
          received = options
          mkdirSync(path.join(options.cwd, 'node_modules'), { recursive: true })
          return Promise.resolve()
        },
      },
    )

    const installerOptions = capturedInstallerOptions(received)
    expect(installerOptions).toMatchObject({
      args: ['install', '--frozen-lockfile', '--backend=copyfile'],
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    })
    expect(installerOptions.env).toEqual(installerEnvironment(installerOptions.cwd))
  })
})
