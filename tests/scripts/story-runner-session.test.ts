// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import {
  constants,
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { chmod, open, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createStoryRunnerSession } from '../../scripts/story-runner-session.js'

const roots: string[] = []

function dependencyTreeHash(): string {
  const hash = createHash('sha256').update('papai-story-dependency-tree-v2\0')
  const entries: [string, string, string][] = [
    ['directory', '@scope', ''],
    ['directory', '@scope/pkg', ''],
  ]
  entries.push(
    ['symlink', '@scope/pkg/alias.js', '@scope/pkg/payload.js'],
    ['file', '@scope/pkg/payload.js', 'export const value = 1\n'],
    ['file', 'captured.txt', 'dependency v1'],
  )
  for (const [kind, relative, contents] of entries) {
    hash.update(`${kind}\0${relative}\0`)
    if (kind !== 'directory') {
      const bytes = Buffer.from(contents)
      hash.update(`${bytes.byteLength}\0`).update(bytes).update('\0')
    }
  }
  return hash.digest('hex')
}

function deferred(): Readonly<{ promise: Promise<void>; resolve(): void }> {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve: (): void => resolve?.(),
  }
}

type OpenHandler = Readonly<{
  matches(target: string, flags: number): boolean
  open(target: string, flags: number, mode?: number): ReturnType<typeof open>
}>

function interceptedOpen(
  handlers: readonly OpenHandler[],
): (target: string, flags: number, mode?: number) => ReturnType<typeof open> {
  return (target: string, flags: number, mode?: number) => {
    const handler = handlers.find((candidate) => candidate.matches(target, flags))
    return handler === undefined ? open(target, flags, mode) : handler.open(target, flags, mode)
  }
}

function isReadOnly(flags: number): boolean {
  return (flags & constants.O_WRONLY) === constants.O_RDONLY
}

function matchesReadOnly(target: string, flags: number, expected: string): boolean {
  return target === expected && isReadOnly(flags)
}

function matchesWritable(target: string, flags: number, expected: string): boolean {
  return target === expected && !isReadOnly(flags)
}

function matchesSessionWritable(target: string, flags: number, name: string): boolean {
  return target.endsWith(`/reports/${name}`) && !isReadOnly(flags)
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => resolve())
  })
}

function cleanupTrackingChmod(onCleanup: () => void): typeof chmod {
  return (target, mode) => {
    if (path.basename(String(target)).startsWith('.papai-story-session-')) onCleanup()
    return chmod(target, mode)
  }
}

function git(root: string, ...args: readonly string[]): void {
  const result = Bun.spawnSync(['git', ...args], { cwd: root, stderr: 'pipe' })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

function makeRemovable(root: string): void {
  const entry = lstatSync(root, { throwIfNoEntry: false })
  if (entry !== undefined && entry.isDirectory()) {
    for (const child of readdirSync(root)) makeRemovable(path.join(root, child))
  }
  chmodSync(root, 0o700)
}

function fixture(): Readonly<{ root: string; dependencyRoot: string }> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-session-'))
  roots.push(root)
  for (const directory of ['tests/stories', 'tests/utils', 'scripts', 'src', 'plugins', 'public']) {
    mkdirSync(path.join(root, directory), { recursive: true })
  }
  writeFileSync(path.join(root, 'tests/stories/preload.ts'), 'preload')
  writeFileSync(path.join(root, 'tests/stories/example.story.test.ts'), `scenario('captured', async () => {})\n`)
  writeFileSync(path.join(root, 'tests/setup.ts'), 'setup')
  writeFileSync(path.join(root, 'tests/mock-reset.ts'), 'reset')
  writeFileSync(path.join(root, 'tests/utils/test-helpers.ts'), 'helpers')
  writeFileSync(path.join(root, 'tests/utils/logger-mock.ts'), 'logger')
  writeFileSync(path.join(root, 'scripts/test-stories.ts'), 'runner')
  writeFileSync(path.join(root, 'src/runtime.ts'), 'runtime v1')
  writeFileSync(path.join(root, 'package.json'), '{"name":"fixture"}')
  writeFileSync(path.join(root, 'bun.lock'), 'lock')
  writeFileSync(path.join(root, 'bunfig.toml'), '')
  const dependencyRoot = path.join(root, '.dependency-cache', 'node_modules')
  mkdirSync(dependencyRoot, { recursive: true })
  writeFileSync(path.join(dependencyRoot, 'captured.txt'), 'dependency v1')
  mkdirSync(path.join(dependencyRoot, '@scope', 'pkg'), { recursive: true })
  writeFileSync(path.join(dependencyRoot, '@scope', 'pkg', 'payload.js'), 'export const value = 1\n')
  symlinkSync('payload.js', path.join(dependencyRoot, '@scope', 'pkg', 'alias.js'))
  chmodSync(path.join(dependencyRoot, '@scope'), 0o500)
  chmodSync(path.join(dependencyRoot, '@scope', 'pkg'), 0o500)
  chmodSync(path.join(dependencyRoot, '@scope', 'pkg', 'payload.js'), 0o400)
  chmodSync(path.join(dependencyRoot, 'captured.txt'), 0o400)
  chmodSync(dependencyRoot, 0o500)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'stories@example.invalid')
  git(root, 'config', 'user.name', 'Story Tests')
  git(root, 'config', 'commit.gpgsign', 'false')
  git(root, 'add', '--', 'tests', 'scripts', 'src', 'plugins', 'public', 'package.json', 'bun.lock', 'bunfig.toml')
  git(root, 'commit', '-qm', 'candidate')
  return { root, dependencyRoot }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    makeRemovable(root)
    rmSync(root, { recursive: true, force: true })
  }
})

describe('story runner session', () => {
  test('exposes the sealed dependency cache through an empty read-only app mountpoint', async () => {
    const { root, dependencyRoot } = fixture()
    mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    writeFileSync(path.join(root, 'node_modules', 'captured.txt'), 'live dependency')
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: ['--reporter-outfile', 'reports/stories/junit.xml'] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
      },
    )
    try {
      expect(readFileSync(path.join(session.appRoot, 'src/runtime.ts'), 'utf8')).toBe('runtime v1')
      expect(statSync(session.appRoot).mode & 0o222).toBe(0)
      expect(statSync(session.tempRoot).mode & 0o777).toBe(0o700)
      expect(path.dirname(session.root)).toBe(realpathSync(os.tmpdir()))
      expect(path.relative(root, session.root).startsWith(`..${path.sep}`)).toBe(true)
      expect(readdirSync(session.root).sort()).toEqual(['app', 'reports', 'tmp'])
      expect(session.dependencyRoot).toBe(dependencyRoot)
      const mountpoint = path.join(session.appRoot, 'node_modules')
      expect(lstatSync(mountpoint).isDirectory()).toBe(true)
      expect(lstatSync(mountpoint).isSymbolicLink()).toBe(false)
      expect(statSync(mountpoint).mode & 0o222).toBe(0)
      expect(readdirSync(mountpoint)).toEqual([])
      expect(session.childReporterArguments).toEqual([
        '--reporter-outfile',
        path.join(session.root, 'reports/junit.xml'),
      ])
      expect(session.childReportPaths).toEqual([path.join(session.root, 'reports/junit.xml')])
      expect(session.reportPaths).toEqual(session.childReportPaths)
      expect(lstatSync(path.join(session.root, 'reports/junit.xml')).isFile()).toBe(true)
      expect(readdirSync(path.join(session.root, 'reports'))).toEqual(['junit.xml'])
      writeFileSync(path.join(root, 'src/runtime.ts'), 'runtime v2')
      expect(readFileSync(path.join(session.appRoot, 'src/runtime.ts'), 'utf8')).toBe('runtime v1')
      await session.verifyIntegrity()
    } finally {
      await session.cleanup()
    }
    expect(existsSync(session.root)).toBe(false)
  })

  test('refuses to copy a session report through a live report-directory symlink', async () => {
    const { root, dependencyRoot } = fixture()
    const outside = mkdtempSync(path.join(os.tmpdir(), 'papai-story-session-outside-'))
    roots.push(outside)
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: ['--reporter-outfile=reports/stories/junit.xml'] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
      },
    )
    try {
      writeFileSync(path.join(session.root, 'reports/junit.xml'), 'report')
      mkdirSync(path.join(root, 'reports'), { recursive: true })
      symlinkSync(outside, path.join(root, 'reports', 'stories'))

      await expect(session.copyReports()).rejects.toThrow('symbolic link')
      expect(existsSync(path.join(outside, 'junit.xml'))).toBe(false)
    } finally {
      await session.cleanup()
    }
  })

  test('copies only the pre-created report to its mapped live destination', async () => {
    const { root, dependencyRoot } = fixture()
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: ['--reporter-outfile', 'reports/stories/junit.xml'] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
      },
    )
    try {
      writeFileSync(path.join(session.root, 'reports/junit.xml'), 'current junit')
      await session.copyReports()

      expect(readFileSync(path.join(root, 'reports/stories/junit.xml'), 'utf8')).toBe('current junit')
    } finally {
      await session.cleanup()
    }
  })

  test('rejects a dependency cache seal mutation after session creation', async () => {
    const { root, dependencyRoot } = fixture()
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: [] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
      },
    )
    try {
      chmodSync(dependencyRoot, 0o700)
      await expect(session.verifyIntegrity()).rejects.toThrow('dependency snapshot')
    } finally {
      await session.cleanup()
    }
  })

  test('waits for sibling report precreation before cleaning a failed session', async () => {
    const { root, dependencyRoot } = fixture()
    const secondOpened = deferred()
    const releaseSecond = deferred()
    const firstFailure = deferred()
    let cleanupStarted = false
    const creation = createStoryRunnerSession(
      {
        root,
        seed: 41021,
        reporterArguments: [
          '--reporter-outfile',
          'reports/stories/first.xml',
          '--reporter-outfile',
          'reports/stories/second.xml',
        ],
      },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
        fileSystem: {
          open: interceptedOpen([
            {
              matches: (target, flags): boolean => matchesSessionWritable(target, flags, 'first.xml'),
              open: async (): ReturnType<typeof open> => {
                await secondOpened.promise
                firstFailure.resolve()
                throw new Error('injected first precreation failure')
              },
            },
            {
              matches: (target, flags): boolean => matchesSessionWritable(target, flags, 'second.xml'),
              open: async (target, flags, mode): ReturnType<typeof open> => {
                const handle = await open(target, flags, mode)
                secondOpened.resolve()
                await releaseSecond.promise
                return handle
              },
            },
          ]),
          chmod: cleanupTrackingChmod((): void => {
            cleanupStarted = true
          }),
        },
      },
    )
    const result = creation.catch((error: unknown): unknown => error)

    await firstFailure.promise
    await nextTurn()
    expect(cleanupStarted).toBe(false)
    releaseSecond.resolve()
    await expect(result).resolves.toBeInstanceOf(Error)
  })

  test('waits for every started report copy before allowing cleanup after a sibling failure', async () => {
    const { root, dependencyRoot } = fixture()
    const secondSourceOpened = deferred()
    const releaseSecondCopy = deferred()
    const destinationFailure = deferred()
    let sessionRoot = ''
    let cleanupStarted = false
    let settled = false
    const session = await createStoryRunnerSession(
      {
        root,
        seed: 41021,
        reporterArguments: [
          '--reporter-outfile',
          'reports/stories/first.xml',
          '--reporter-outfile',
          'reports/stories/second.xml',
        ],
      },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
        fileSystem: {
          open: interceptedOpen([
            {
              matches: (target, flags): boolean =>
                matchesWritable(target, flags, path.join(root, 'reports/stories/first.xml')),
              open: async (): ReturnType<typeof open> => {
                await secondSourceOpened.promise
                destinationFailure.resolve()
                throw new Error('injected first destination failure')
              },
            },
            {
              matches: (target, flags): boolean =>
                matchesReadOnly(target, flags, path.join(sessionRoot, 'reports/second.xml')),
              open: async (target, flags, mode): ReturnType<typeof open> => {
                const handle = await open(target, flags, mode)
                secondSourceOpened.resolve()
                await releaseSecondCopy.promise
                return handle
              },
            },
          ]),
          rm: (target, options) => {
            cleanupStarted = true
            return rm(target, options)
          },
        },
      },
    )
    sessionRoot = session.root
    try {
      writeFileSync(path.join(session.root, 'reports/first.xml'), 'first')
      writeFileSync(path.join(session.root, 'reports/second.xml'), 'second')
      const copy = session.copyReports().catch((error: unknown): unknown => error)
      const cleanup = copy.then(async (): Promise<void> => {
        settled = true
        await session.cleanup()
      })

      await destinationFailure.promise
      await nextTurn()
      expect(settled).toBe(false)
      expect(cleanupStarted).toBe(false)
      releaseSecondCopy.resolve()
      await cleanup
    } finally {
      releaseSecondCopy.resolve()
      await session.cleanup()
    }
  })

  test('closes the source handle when opening its destination fails', async () => {
    const { root, dependencyRoot } = fixture()
    let sessionRoot = ''
    let sourceOpened = false
    let sourceCloseCalls = 0
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: ['--reporter-outfile', 'reports/stories/junit.xml'] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
        fileSystem: {
          open: interceptedOpen([
            {
              matches: (target, flags): boolean =>
                matchesWritable(target, flags, path.join(root, 'reports/stories/junit.xml')),
              open: (): ReturnType<typeof open> => Promise.reject(new Error('injected destination failure')),
            },
            {
              matches: (target, flags): boolean =>
                matchesReadOnly(target, flags, path.join(sessionRoot, 'reports/junit.xml')),
              open: async (target, flags, mode): ReturnType<typeof open> => {
                const handle = await open(target, flags, mode)
                sourceOpened = true
                const close = handle.close.bind(handle)
                Object.defineProperty(handle, 'close', {
                  value: async (): Promise<void> => {
                    sourceCloseCalls += 1
                    await close()
                  },
                })
                return handle
              },
            },
          ]),
        },
      },
    )
    sessionRoot = session.root
    try {
      await expect(session.copyReports()).rejects.toThrow('injected destination failure')
      expect(sourceOpened).toBe(true)
      expect(sourceCloseCalls).toBe(1)
    } finally {
      await session.cleanup()
    }
  })

  test('rejects an ancestor swap that routes an opened report outside the live root', async () => {
    const { root, dependencyRoot } = fixture()
    const outside = mkdtempSync(path.join(os.tmpdir(), 'papai-story-session-race-'))
    roots.push(outside)
    const liveReports = path.join(root, 'reports/stories')
    const session = await createStoryRunnerSession(
      { root, seed: 41021, reporterArguments: ['--reporter-outfile', 'reports/stories/junit.xml'] },
      {
        acquireDependencySnapshot: () =>
          Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
        fileSystem: {
          open: interceptedOpen([
            {
              matches: (target): boolean => target === path.join(root, 'reports/stories/junit.xml'),
              open: (target, flags, mode): ReturnType<typeof open> => {
                rmSync(liveReports, { recursive: true })
                symlinkSync(outside, liveReports)
                return open(target, flags, mode)
              },
            },
          ]),
        },
      },
    )
    try {
      writeFileSync(path.join(session.root, 'reports/junit.xml'), 'report')
      mkdirSync(liveReports, { recursive: true })

      await expect(session.copyReports()).rejects.toThrow('symbolic link')
      expect(readFileSync(path.join(outside, 'junit.xml'), 'utf8')).toBe('')
    } finally {
      await session.cleanup()
    }
  })

  test.each([
    ['bare name', ['--reporter-outfile', 'junit.xml']],
    ['absolute path', ['--reporter-outfile=/tmp/junit.xml']],
    ['nested report', ['--reporter-outfile', 'reports/stories/nested/junit.xml']],
    ['non-XML report', ['--reporter-outfile', 'reports/stories/junit.json']],
    ['duplicate report', ['--reporter-outfile', 'reports/stories/junit.xml', '--reporter-outfile=junit.xml']],
  ] as const)('rejects a %s reporter path', async (_name, reporterArguments) => {
    const { root, dependencyRoot } = fixture()

    await expect(
      createStoryRunnerSession(
        { root, seed: 41021, reporterArguments },
        {
          acquireDependencySnapshot: () =>
            Promise.resolve({ key: 'a'.repeat(64), root: dependencyRoot, treeHash: dependencyTreeHash() }),
        },
      ),
    ).rejects.toThrow('reporter outfile')
  })
})
