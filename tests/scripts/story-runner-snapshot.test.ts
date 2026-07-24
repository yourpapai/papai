// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { StoryDependencySnapshot } from '../../scripts/story/dependencies.js'
import { createCandidateStorySnapshotSource, StorySnapshotInterruptedError } from '../../scripts/story/snapshot.js'

const roots: string[] = []
const TEST_DEPENDENCY_SNAPSHOT: StoryDependencySnapshot = {
  key: 'a'.repeat(64),
  root: '/dependency-cache/node_modules',
  treeHash: 'b'.repeat(64),
}
type SnapshotTestDependencies = NonNullable<Parameters<typeof createCandidateStorySnapshotSource>[1]>

function makeRemovableTree(directory: string): void {
  chmodSync(directory, 0o700)
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) makeRemovableTree(path.join(directory, entry.name))
  }
}

async function createSnapshot(
  options: Readonly<{ root: string; seed: number; bunVersion?: string }>,
  dependencies: SnapshotTestDependencies = {},
): Promise<
  Readonly<{
    root: string
    manifest: Awaited<ReturnType<typeof createCandidateStorySnapshotSource>>['manifest']
    verifyIntegrity(): Promise<void>
    cleanup(): Promise<void>
  }>
> {
  const source = await createCandidateStorySnapshotSource(options, {
    candidateCaptureDependencies: {
      acquireDependencySnapshot: (): Promise<StoryDependencySnapshot> => Promise.resolve(TEST_DEPENDENCY_SNAPSHOT),
    },
    ...dependencies,
  })
  const snapshotRoot = mkdtempSync(path.join(realpathSync(os.tmpdir()), 'papai-story-snapshot-'))
  const cleanup = (): Promise<void> => {
    makeRemovableTree(snapshotRoot)
    rmSync(snapshotRoot, { recursive: true, force: true })
    return Promise.resolve()
  }
  try {
    const materialized = await source.materialize(snapshotRoot)
    return { root: snapshotRoot, manifest: source.manifest, verifyIntegrity: materialized.verifyIntegrity, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

function requireInterruptedError(value: unknown): StorySnapshotInterruptedError {
  if (value instanceof StorySnapshotInterruptedError) return value
  throw new Error('Expected StorySnapshotInterruptedError')
}

function mappedAction<K, T>(actions: ReadonlyMap<K, T>, key: K, fallback: T): T {
  return actions.get(key) ?? fallback
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function git(root: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-snapshot-'))
  roots.push(root)
  mkdirSync(path.join(root, 'tests/stories'), { recursive: true })
  mkdirSync(path.join(root, 'tests/utils'), { recursive: true })
  mkdirSync(path.join(root, 'scripts/story'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  mkdirSync(path.join(root, 'plugins/example'), { recursive: true })
  mkdirSync(path.join(root, 'public'), { recursive: true })
  writeFileSync(path.join(root, 'tests/stories/preload.ts'), 'captured preload')
  writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), `scenario('captured', async () => {})\n`)
  writeFileSync(path.join(root, 'tests/setup.ts'), 'setup')
  writeFileSync(path.join(root, 'tests/mock-reset.ts'), 'reset')
  writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), 'helper')
  writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), 'logger')
  writeFileSync(path.join(root, 'scripts/story/test-stories.ts'), 'captured runner')
  writeFileSync(path.join(root, 'src/live.ts'), 'production v1')
  symlinkSync('live.ts', path.join(root, 'src/alias.ts'))
  writeFileSync(path.join(root, 'plugins/example/plugin.json'), '{"name":"example"}')
  writeFileSync(path.join(root, 'public/settings.js'), 'settings asset')
  writeFileSync(path.join(root, 'package.json'), '{"name":"story-fixture"}')
  writeFileSync(path.join(root, 'bun.lock'), 'lockfile')
  writeFileSync(path.join(root, 'bunfig.toml'), '')
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'stories@example.invalid')
  git(root, 'config', 'user.name', 'Story Tests')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(
    root,
    'add',
    '--',
    'tests/stories',
    'scripts',
    'src',
    'plugins',
    'public',
    'package.json',
    'bun.lock',
    'bunfig.toml',
  )
  git(root, 'commit', '-qm', 'candidate')
  return root
}

describe('candidate story snapshot', () => {
  test('materializes captured runtime inputs without live-worktree bridges', async () => {
    const root = fixture()
    const snapshot = await createSnapshot({ root, seed: 41021 })
    const capturedStory = path.join(snapshot.root, 'tests/stories/example.story.test.ts')
    try {
      expect(path.relative(root, snapshot.root).startsWith(`..${path.sep}`)).toBe(true)
      writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), 'mutated story')
      writeFileSync(path.join(root, 'src/live.ts'), 'production v2')

      expect(readFileSync(capturedStory, 'utf8')).toBe(`scenario('captured', async () => {})\n`)
      expect(statSync(capturedStory).mode & 0o222).toBe(0)
      expect(lstatSync(path.join(snapshot.root, 'src')).isSymbolicLink()).toBe(false)
      expect(lstatSync(path.join(snapshot.root, 'plugins')).isSymbolicLink()).toBe(false)
      expect(lstatSync(path.join(snapshot.root, 'package.json')).isSymbolicLink()).toBe(false)
      expect(lstatSync(path.join(snapshot.root, 'bun.lock')).isSymbolicLink()).toBe(false)
      expect(lstatSync(path.join(snapshot.root, 'public')).isSymbolicLink()).toBe(false)
      expect(readFileSync(path.join(snapshot.root, 'src/live.ts'), 'utf8')).toBe('production v1')
      expect(readFileSync(path.join(snapshot.root, 'src/alias.ts'), 'utf8')).toBe('production v1')
      expect(readlinkSync(path.join(snapshot.root, 'src/alias.ts'))).toBe('live.ts')
      expect(readFileSync(path.join(snapshot.root, 'plugins/example/plugin.json'), 'utf8')).toBe('{"name":"example"}')
      expect(readFileSync(path.join(snapshot.root, 'package.json'), 'utf8')).toBe('{"name":"story-fixture"}')
      expect(readFileSync(path.join(snapshot.root, 'bun.lock'), 'utf8')).toBe('lockfile')
      expect(readFileSync(path.join(snapshot.root, 'public/settings.js'), 'utf8')).toBe('settings asset')
      await snapshot.verifyIntegrity()
    } finally {
      await snapshot.cleanup()
    }
    expect(existsSync(snapshot.root)).toBe(false)
  })

  test('materializes empty captured runtime directories', async () => {
    const root = fixture()
    rmSync(path.join(root, 'src', 'alias.ts'))
    rmSync(path.join(root, 'src', 'live.ts'))
    rmSync(path.join(root, 'plugins', 'example'), { recursive: true })
    rmSync(path.join(root, 'public', 'settings.js'))
    const snapshot = await createSnapshot({ root, seed: 41021 })
    try {
      expect(lstatSync(path.join(snapshot.root, 'src')).isDirectory()).toBe(true)
      expect(lstatSync(path.join(snapshot.root, 'plugins')).isDirectory()).toBe(true)
      expect(lstatSync(path.join(snapshot.root, 'public')).isDirectory()).toBe(true)
      await snapshot.verifyIntegrity()
    } finally {
      await snapshot.cleanup()
    }
  })

  test('rejects a removed empty captured runtime directory before execution', async () => {
    const root = fixture()
    rmSync(path.join(root, 'src', 'alias.ts'))
    rmSync(path.join(root, 'src', 'live.ts'))
    const snapshot = await createSnapshot({ root, seed: 41021 })
    try {
      chmodSync(snapshot.root, 0o700)
      rmSync(path.join(snapshot.root, 'src'), { recursive: true })

      await expect(snapshot.verifyIntegrity()).rejects.toThrow(
        'Snapshot integrity check failed: src is not a directory',
      )
    } finally {
      await snapshot.cleanup()
    }
  })

  test('rejects a tampered captured runtime file before execution', async () => {
    const root = fixture()
    const snapshot = await createSnapshot({ root, seed: 41021 })
    const runtimeDirectory = path.join(snapshot.root, 'src')
    try {
      const runtimeFile = path.join(runtimeDirectory, 'live.ts')
      chmodSync(runtimeDirectory, 0o700)
      chmodSync(runtimeFile, 0o600)
      writeFileSync(runtimeFile, 'tampered runtime')
      await expect(snapshot.verifyIntegrity()).rejects.toThrow(
        'Snapshot integrity check failed: src/live.ts hash changed',
      )
    } finally {
      await snapshot.cleanup()
    }
  })

  test('rejects an unexpected runtime path before execution', async () => {
    const root = fixture()
    const snapshot = await createSnapshot({ root, seed: 41021 })
    const runtimeDirectory = path.join(snapshot.root, 'src')
    try {
      chmodSync(runtimeDirectory, 0o700)
      writeFileSync(path.join(runtimeDirectory, 'unexpected.ts'), 'unexpected runtime input')

      await expect(snapshot.verifyIntegrity()).rejects.toThrow(
        'Snapshot integrity check failed: unexpected entry: src/unexpected.ts',
      )
    } finally {
      await snapshot.cleanup()
    }
  })

  test.each([
    ['mutation', (capturedStory: string): void => writeFileSync(capturedStory, 'tampered snapshot')],
    [
      'symlink',
      (capturedStory: string, root: string): void =>
        symlinkSync(path.join(root, 'tests/stories/example.story.test.ts'), capturedStory),
    ],
  ] as const)('rejects snapshot %s before execution', async (_replacement, replace) => {
    const root = fixture()
    const snapshot = await createSnapshot({ root, seed: 41021 })
    const capturedStory = path.join(snapshot.root, 'tests/stories/example.story.test.ts')
    chmodSync(path.dirname(capturedStory), 0o700)
    rmSync(capturedStory)
    replace(capturedStory, root)
    try {
      await expect(snapshot.verifyIntegrity()).rejects.toThrow('Snapshot integrity check failed')
    } finally {
      await snapshot.cleanup()
    }
  })

  test('cleans a partially constructed snapshot when terminated during materialization', async () => {
    const root = fixture()
    const safetyHandler = (): void => undefined
    process.once('SIGTERM', safetyHandler)
    try {
      const caught = await createSnapshot(
        { root, seed: 41021 },
        {
          afterRootCreated: () => {
            process.emit('SIGTERM')
            return Promise.resolve()
          },
        },
      ).catch((error: unknown): unknown => error)

      expect(caught).toBeInstanceOf(StorySnapshotInterruptedError)
      expect(requireInterruptedError(caught).exitCode).toBe(143)
      expect(
        Bun.spawnSync(['find', root, '-maxdepth', '1', '-name', '.papai-story-snapshot-*'], {
          stdout: 'pipe',
        }).stdout.toString(),
      ).toBe('')
    } finally {
      process.off('SIGTERM', safetyHandler)
    }
  })

  test('waits for sibling materialization before cleaning a failed snapshot', async () => {
    const root = fixture()
    let releaseSibling: (() => void) | undefined
    const sibling = new Promise<void>((resolve) => {
      releaseSibling = resolve
    })
    let lateWrite: Promise<void> | undefined
    let snapshotRoot = ''
    const writeNormally = (targetRoot: string, file: Readonly<{ path: string; bytes: Uint8Array }>): Promise<void> => {
      const output = path.join(targetRoot, file.path)
      mkdirSync(path.dirname(output), { recursive: true })
      writeFileSync(output, file.bytes)
      return Promise.resolve()
    }
    const writeActions = new Map([
      ['tests/stories/preload.ts', (): Promise<void> => Promise.reject(new Error('injected write failure'))],
      [
        'tests/stories/example.story.test.ts',
        (targetRoot: string, file: Readonly<{ path: string; bytes: Uint8Array }>): Promise<void> => {
          const output = path.join(targetRoot, file.path)
          lateWrite = sibling.then(() => {
            mkdirSync(path.dirname(output), { recursive: true })
            writeFileSync(output, file.bytes)
          })
          return lateWrite
        },
      ],
    ])

    const creation = createSnapshot(
      { root, seed: 41021 },
      {
        writeCapturedFile: (targetRoot, file): Promise<void> => {
          snapshotRoot = targetRoot
          return mappedAction(writeActions, file.path, writeNormally)(targetRoot, file)
        },
      },
    )

    const rejection = creation.catch((error: unknown): unknown => error)
    await Bun.sleep(0)
    releaseSibling?.()
    const caught = await rejection
    await lateWrite

    expect(caught).toBeInstanceOf(Error)
    expect(existsSync(snapshotRoot)).toBe(false)
  })

  test('waits for sibling permission hardening before cleaning a failed snapshot', async () => {
    const root = fixture()
    let releaseSibling: (() => void) | undefined
    const sibling = new Promise<void>((resolve) => {
      releaseSibling = resolve
    })
    let lateChmod: Promise<void> | undefined
    let snapshotRoot = ''
    const changeNormally = (target: string, mode: number): Promise<void> => {
      chmodSync(target, mode)
      return Promise.resolve()
    }
    let changeActions = new Map<string, (target: string, mode: number) => Promise<void>>()

    const creation = createSnapshot(
      { root, seed: 41021 },
      {
        afterRootCreated: (target): Promise<void> => {
          snapshotRoot = target
          changeActions = new Map([
            [
              path.join(target, 'tests', 'stories'),
              (): Promise<void> => Promise.reject(new Error('injected chmod failure')),
            ],
            [
              path.join(target, 'tests', 'utils'),
              (changeTarget: string, mode: number): Promise<void> => {
                lateChmod = sibling.then(() => chmodSync(changeTarget, mode))
                return lateChmod
              },
            ],
          ])
          return Promise.resolve()
        },
        changeMode: (target, mode): Promise<void> => {
          return mappedAction(changeActions, target, changeNormally)(target, mode)
        },
      },
    )

    const rejection = creation.then(
      async (snapshot): Promise<unknown> => {
        await snapshot.cleanup()
        return snapshot
      },
      (error: unknown): unknown => error,
    )
    await Bun.sleep(0)
    releaseSibling?.()
    const caught = await rejection
    await lateChmod

    expect(caught).toBeInstanceOf(Error)
    expect(existsSync(snapshotRoot)).toBe(false)
  })
})
