// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants } from 'node:fs'
import { lstat, open, readdir } from 'node:fs/promises'
import path from 'node:path'

const FROZEN_TEST_SUPPORT = new Set([
  'bunfig.toml',
  'tests/mock-reset.ts',
  'tests/setup.ts',
  'tests/utils/logger-mock.ts',
  'tests/utils/test-helpers.ts',
])

export function isFrozenEnforcementPath(filePath: string): boolean {
  return /^scripts\/story\/(?:[^/]+\.ts|sandbox-image\.txt)$/u.test(filePath)
}

export function isFrozenTestSupportPath(filePath: string): boolean {
  return FROZEN_TEST_SUPPORT.has(filePath)
}

// coverage modules the frozen enforcement tree imports; the snapshot must carry them or the runner cannot load.
export const FROZEN_COVERAGE_SUPPORT: readonly string[] = [
  'scripts/coverage/normalize-lcov.ts',
  'scripts/coverage/ratchet-lib.ts',
  'scripts/coverage/story-coverage-gate.ts',
  'scripts/coverage/story-coverage-report.ts',
  'scripts/coverage/story-scope.ts',
]

const FROZEN_COVERAGE_SUPPORT_PATHS = new Set(FROZEN_COVERAGE_SUPPORT)

export function isFrozenCoverageSupportPath(filePath: string): boolean {
  return FROZEN_COVERAGE_SUPPORT_PATHS.has(filePath)
}

const STORIES_PREFIX = 'tests/stories'
const ENFORCEMENT_PREFIX = 'scripts/story'
const COVERAGE_SUPPORT_PREFIX = 'scripts/coverage'

export function isCapturedStoryInputPath(filePath: string): boolean {
  return (
    filePath.startsWith(`${STORIES_PREFIX}/`) ||
    isFrozenEnforcementPath(filePath) ||
    isFrozenTestSupportPath(filePath) ||
    isFrozenCoverageSupportPath(filePath)
  )
}

export type LoadedStoryFile = Readonly<{ path: string; bytes: Uint8Array }>
export type CandidateCaptureDependencies = Readonly<{
  afterDirectoryRead?(directory: string): Promise<void>
}>

export function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

export async function readCandidateFile(absolute: string, relative: string): Promise<Uint8Array> {
  const before = await lstat(absolute)
  if (!before.isFile()) {
    const kind = before.isSymbolicLink() ? 'symbolic link' : 'special file'
    throw new Error(`Unsupported story manifest entry: ${relative} (${kind})`)
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    const after = await handle.stat()
    if (!after.isFile()) throw new Error(`Unsupported story manifest entry: ${relative} (special file)`)
    return await handle.readFile()
  } catch (error) {
    if (errorCode(error) === 'ELOOP') {
      throw new Error(`Unsupported story manifest entry: ${relative} (symbolic link)`, { cause: error })
    }
    throw error
  } finally {
    await handle?.close()
  }
}

export function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export type DirectoryIdentity = Readonly<{ dev: number | bigint; ino: number | bigint }>

export function directoryIdentity(stats: Awaited<ReturnType<typeof lstat>>): DirectoryIdentity {
  return { dev: stats.dev, ino: stats.ino }
}

export async function assertDirectoryIdentity(
  root: string,
  directory: string,
  expected: DirectoryIdentity,
): Promise<void> {
  const relative = toPosix(path.relative(root, directory))
  const current = await lstat(directory).catch(() => undefined)
  if (
    current === undefined ||
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== expected.dev ||
    current.ino !== expected.ino
  ) {
    throw new Error(`Story manifest directory changed during capture: ${relative}`)
  }
}

async function visitDirectory(
  root: string,
  directory: string,
  expected: DirectoryIdentity,
  files: LoadedStoryFile[],
  dependencies: CandidateCaptureDependencies,
): Promise<void> {
  await assertDirectoryIdentity(root, directory, expected)
  const entries = await readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => compareText(left.name, right.name))
  const capturedEntries = await Promise.all(
    entries.map(async (entry) => ({ entry, stats: await lstat(path.join(directory, entry.name)) })),
  )
  await dependencies.afterDirectoryRead?.(directory)
  await Promise.all(
    capturedEntries.map(async ({ entry, stats }): Promise<void> => {
      const absolute = path.join(directory, entry.name)
      const relative = toPosix(path.relative(root, absolute))
      if (stats.isDirectory()) {
        await visitDirectory(root, absolute, directoryIdentity(stats), files, dependencies)
      } else if (stats.isFile()) files.push({ path: relative, bytes: await readCandidateFile(absolute, relative) })
      else {
        const kind = stats.isSymbolicLink() ? 'symbolic link' : 'special file'
        throw new Error(`Unsupported story manifest entry: ${relative} (${kind})`)
      }
    }),
  )
  await assertDirectoryIdentity(root, directory, expected)
}

async function loadSelectedDirectoryFiles(
  root: string,
  relativeDirectory: string,
  selected: (relative: string) => boolean,
  dependencies: CandidateCaptureDependencies,
): Promise<readonly LoadedStoryFile[]> {
  const directory = path.join(root, relativeDirectory)
  const before = await lstat(directory)
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`Story manifest directory changed during capture: ${relativeDirectory}`)
  }
  const expected = directoryIdentity(before)
  const entries = await readdir(directory, { withFileTypes: true })
  const captured = await Promise.all(
    entries.map(async (entry) => ({ entry, stats: await lstat(path.join(directory, entry.name)) })),
  )
  await dependencies.afterDirectoryRead?.(directory)
  const files = await Promise.all(
    captured.map(async ({ entry, stats }): Promise<LoadedStoryFile | undefined> => {
      const relative = relativeDirectory === '' ? entry.name : `${relativeDirectory}/${entry.name}`
      if (!selected(relative)) return undefined
      if (!stats.isFile()) {
        const kind = stats.isSymbolicLink() ? 'symbolic link' : 'special file'
        throw new Error(`Unsupported story manifest entry: ${relative} (${kind})`)
      }
      return { path: relative, bytes: await readCandidateFile(path.join(root, relative), relative) }
    }),
  )
  await assertDirectoryIdentity(root, directory, expected)
  return files.filter((file): file is LoadedStoryFile => file !== undefined)
}

function assertFrozenCoverageSupport(files: readonly LoadedStoryFile[]): void {
  const captured = new Set(files.map((file) => file.path))
  const missing = FROZEN_COVERAGE_SUPPORT.filter((filePath) => !captured.has(filePath)).toSorted(compareText)
  if (missing.length > 0) throw new Error(`Missing frozen story coverage input: ${missing.join(', ')}`)
}

export async function loadCandidateStoryFiles(
  root: string,
  dependencies: CandidateCaptureDependencies = {},
): Promise<readonly LoadedStoryFile[]> {
  const storiesRoot = path.join(root, STORIES_PREFIX)
  const rootEntry = await lstat(storiesRoot).catch((error: unknown) => {
    throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (missing)`, { cause: error })
  })
  if (rootEntry.isSymbolicLink()) {
    throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (symbolic link)`)
  }
  if (!rootEntry.isDirectory()) throw new Error(`Unsupported story manifest root: ${STORIES_PREFIX} (not a directory)`)
  const files: LoadedStoryFile[] = []
  await visitDirectory(root, storiesRoot, directoryIdentity(rootEntry), files, dependencies)
  const selected = await Promise.all([
    loadSelectedDirectoryFiles(root, '', isFrozenTestSupportPath, dependencies),
    loadSelectedDirectoryFiles(root, ENFORCEMENT_PREFIX, isFrozenEnforcementPath, dependencies),
    loadSelectedDirectoryFiles(root, COVERAGE_SUPPORT_PREFIX, isFrozenCoverageSupportPath, dependencies),
    loadSelectedDirectoryFiles(root, 'tests', isFrozenTestSupportPath, dependencies),
    loadSelectedDirectoryFiles(root, 'tests/utils', isFrozenTestSupportPath, dependencies),
  ])
  files.push(...selected.flat())
  assertFrozenCoverageSupport(files)
  return files.sort((left, right) => compareText(left.path, right.path))
}
