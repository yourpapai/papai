// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { constants } from 'node:fs'
import { lstat, open, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'

const STORIES_PREFIX = 'tests/stories'
export const REQUIRED_RUNTIME_DIRECTORY_ROOTS = ['src', 'plugins'] as const
const OPTIONAL_RUNTIME_DIRECTORY_ROOTS = ['public'] as const
export const REQUIRED_RUNTIME_FILE_ROOTS = ['package.json', 'bun.lock'] as const
const RUNTIME_FILE_ROOTS = new Set<string>(REQUIRED_RUNTIME_FILE_ROOTS)
const FROZEN_TEST_SUPPORT = new Set([
  'bunfig.toml',
  'tests/mock-reset.ts',
  'tests/setup.ts',
  'tests/utils/logger-mock.ts',
  'tests/utils/test-helpers.ts',
])

export type LoadedStoryFile = Readonly<{ path: string; bytes: Uint8Array }>
export type LoadedRuntimeFile = Readonly<{ kind: 'file'; path: string; bytes: Uint8Array }>
export type LoadedRuntimeSymlink = Readonly<{ kind: 'symlink'; path: string; target: string }>
export type LoadedRuntimeInput = LoadedRuntimeFile | LoadedRuntimeSymlink
export type LoadedRuntimeInputTree = Readonly<{ directories: readonly string[]; files: readonly LoadedRuntimeInput[] }>
export type CandidateCaptureDependencies = Readonly<{
  afterDirectoryRead?(directory: string): Promise<void>
}>

export function isFrozenEnforcementPath(filePath: string): boolean {
  return (
    filePath === 'scripts/test-stories.ts' ||
    filePath === 'scripts/story-reports.ts' ||
    /^scripts\/story-(?:manifest|runner).*\.ts$/u.test(filePath)
  )
}

export function isFrozenTestSupportPath(filePath: string): boolean {
  return FROZEN_TEST_SUPPORT.has(filePath)
}

export function isRuntimeInputPath(filePath: string): boolean {
  return (
    RUNTIME_FILE_ROOTS.has(filePath) ||
    [...REQUIRED_RUNTIME_DIRECTORY_ROOTS, ...OPTIONAL_RUNTIME_DIRECTORY_ROOTS].some((root) =>
      filePath.startsWith(`${root}/`),
    )
  )
}

export function assertRuntimeSymlinkTarget(root: string, filePath: string, target: string): void {
  const source = path.resolve(root, filePath)
  const resolved = path.resolve(path.dirname(source), target)
  const relative = path.relative(root, resolved)
  if (
    target.includes('\\') ||
    path.isAbsolute(target) ||
    path.win32.isAbsolute(target) ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    !isRuntimeInputPath(toPosix(relative))
  ) {
    throw new Error(`Unsupported story runtime symlink: ${filePath} -> ${target}`)
  }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

async function readCandidateFile(absolute: string, relative: string): Promise<Uint8Array> {
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

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

type DirectoryIdentity = Readonly<{ dev: number | bigint; ino: number | bigint }>

function directoryIdentity(stats: Awaited<ReturnType<typeof lstat>>): DirectoryIdentity {
  return { dev: stats.dev, ino: stats.ino }
}

async function assertDirectoryIdentity(root: string, directory: string, expected: DirectoryIdentity): Promise<void> {
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
    loadSelectedDirectoryFiles(root, 'scripts', isFrozenEnforcementPath, dependencies),
    loadSelectedDirectoryFiles(root, 'tests', isFrozenTestSupportPath, dependencies),
    loadSelectedDirectoryFiles(root, 'tests/utils', isFrozenTestSupportPath, dependencies),
  ])
  files.push(...selected.flat())
  return files.sort((left, right) => compareText(left.path, right.path))
}

async function readRuntimeInput(root: string, relative: string): Promise<LoadedRuntimeInput> {
  const absolute = path.join(root, relative)
  const before = await lstat(absolute)
  if (before.isFile()) return { kind: 'file', path: relative, bytes: await readCandidateFile(absolute, relative) }
  if (!before.isSymbolicLink()) throw new Error(`Unsupported story manifest entry: ${relative} (special file)`)
  const target = await readlink(absolute)
  const after = await lstat(absolute)
  if (!after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino) {
    throw new Error(`Story manifest runtime entry changed during capture: ${relative}`)
  }
  assertRuntimeSymlinkTarget(root, relative, target)
  return { kind: 'symlink', path: relative, target }
}

async function visitRuntimeDirectory(
  root: string,
  directory: string,
  expected: DirectoryIdentity,
  directories: string[],
  inputs: LoadedRuntimeInput[],
  dependencies: CandidateCaptureDependencies,
): Promise<void> {
  await assertDirectoryIdentity(root, directory, expected)
  directories.push(toPosix(path.relative(root, directory)))
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
        await visitRuntimeDirectory(root, absolute, directoryIdentity(stats), directories, inputs, dependencies)
      } else inputs.push(await readRuntimeInput(root, relative))
    }),
  )
  await assertDirectoryIdentity(root, directory, expected)
}

async function loadRuntimeDirectory(
  root: string,
  relativeDirectory: string,
  required: boolean,
  dependencies: CandidateCaptureDependencies,
): Promise<LoadedRuntimeInputTree> {
  const directory = path.join(root, relativeDirectory)
  const entry = await lstat(directory).catch((error: unknown) => {
    if (!required && errorCode(error) === 'ENOENT') return undefined
    throw new Error(`Unsupported story runtime root: ${relativeDirectory} (missing)`, { cause: error })
  })
  if (entry === undefined) return { directories: [], files: [] }
  if (entry.isSymbolicLink()) {
    throw new Error(`Unsupported story runtime root: ${relativeDirectory} (symbolic link)`)
  }
  if (!entry.isDirectory()) throw new Error(`Unsupported story runtime root: ${relativeDirectory} (not a directory)`)
  const inputs: LoadedRuntimeInput[] = []
  const directories: string[] = []
  await visitRuntimeDirectory(root, directory, directoryIdentity(entry), directories, inputs, dependencies)
  return { directories: directories.sort(compareText), files: inputs }
}

export async function loadCandidateRuntimeInputTree(
  root: string,
  dependencies: CandidateCaptureDependencies = {},
): Promise<LoadedRuntimeInputTree> {
  const directories = await Promise.all([
    ...REQUIRED_RUNTIME_DIRECTORY_ROOTS.map((relativeDirectory) =>
      loadRuntimeDirectory(root, relativeDirectory, true, dependencies),
    ),
    ...OPTIONAL_RUNTIME_DIRECTORY_ROOTS.map((relativeDirectory) =>
      loadRuntimeDirectory(root, relativeDirectory, false, dependencies),
    ),
  ])
  const files = await Promise.all(
    [...RUNTIME_FILE_ROOTS].sort(compareText).map((relative) => readRuntimeInput(root, relative)),
  )
  return {
    directories: directories.flatMap((tree) => tree.directories).sort(compareText),
    files: [...directories.flatMap((tree) => tree.files), ...files].sort((left, right) =>
      compareText(left.path, right.path),
    ),
  }
}
