// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createCandidateStorySnapshot, StorySnapshotInterruptedError } from '../../scripts/story-runner-snapshot.js'

const roots: string[] = []

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
  mkdirSync(path.join(root, 'scripts'), { recursive: true })
  mkdirSync(path.join(root, 'src'), { recursive: true })
  writeFileSync(path.join(root, 'tests/stories/preload.ts'), 'captured preload')
  writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), `scenario('captured', async () => {})\n`)
  writeFileSync(path.join(root, 'tests/setup.ts'), 'setup')
  writeFileSync(path.join(root, 'tests/mock-reset.ts'), 'reset')
  writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), 'helper')
  writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), 'logger')
  writeFileSync(path.join(root, 'scripts/test-stories.ts'), 'captured runner')
  writeFileSync(path.join(root, 'src/live.ts'), 'production v1')
  writeFileSync(path.join(root, 'bunfig.toml'), '')
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'stories@example.invalid')
  git(root, 'config', 'user.name', 'Story Tests')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'add', '--', 'tests/stories', 'scripts', 'src', 'bunfig.toml')
  git(root, 'commit', '-qm', 'candidate')
  return root
}

describe('candidate story snapshot', () => {
  test('freezes captured harness bytes while production source remains live', async () => {
    const root = fixture()
    const snapshot = await createCandidateStorySnapshot({ root, seed: 41021 })
    const capturedStory = path.join(snapshot.root, 'tests/stories/example.story.test.ts')
    try {
      writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), 'mutated story')
      writeFileSync(path.join(root, 'src/live.ts'), 'production v2')

      expect(readFileSync(capturedStory, 'utf8')).toBe(`scenario('captured', async () => {})\n`)
      expect(statSync(capturedStory).mode & 0o222).toBe(0)
      expect(readFileSync(path.join(snapshot.root, 'src/live.ts'), 'utf8')).toBe('production v2')
    } finally {
      await snapshot.cleanup()
    }
    expect(existsSync(snapshot.root)).toBe(false)
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
    const snapshot = await createCandidateStorySnapshot({ root, seed: 41021 })
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
      const caught = await createCandidateStorySnapshot(
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

    const creation = createCandidateStorySnapshot(
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

    const creation = createCandidateStorySnapshot(
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
