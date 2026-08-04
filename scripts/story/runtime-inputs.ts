// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { lstat, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'

import {
  assertDirectoryIdentity,
  type CandidateCaptureDependencies,
  compareText,
  directoryIdentity,
  type DirectoryIdentity,
  errorCode,
  readCandidateFile,
  toPosix,
} from './inputs.js'

export const REQUIRED_RUNTIME_DIRECTORY_ROOTS = ['src', 'plugins'] as const
const OPTIONAL_RUNTIME_DIRECTORY_ROOTS = ['public'] as const
export const REQUIRED_RUNTIME_FILE_ROOTS = ['package.json', 'bun.lock'] as const
// Candidate-provided documents the frozen harness contract tests read (e.g. behavior
// source anchors). Optional so fixtures and baselines predating the document still load.
const OPTIONAL_RUNTIME_FILE_ROOTS = ['docs/architecture/behaviors.md'] as const
const RUNTIME_FILE_ROOTS = new Set<string>([...REQUIRED_RUNTIME_FILE_ROOTS, ...OPTIONAL_RUNTIME_FILE_ROOTS])

export type LoadedRuntimeFile = Readonly<{ kind: 'file'; path: string; bytes: Uint8Array }>
export type LoadedRuntimeSymlink = Readonly<{ kind: 'symlink'; path: string; target: string }>
export type LoadedRuntimeInput = LoadedRuntimeFile | LoadedRuntimeSymlink
export type LoadedRuntimeInputTree = Readonly<{ directories: readonly string[]; files: readonly LoadedRuntimeInput[] }>

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

async function readOptionalRuntimeInput(root: string, relative: string): Promise<LoadedRuntimeInput | undefined> {
  try {
    return await readRuntimeInput(root, relative)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  }
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
  const [requiredFiles, optionalFiles] = await Promise.all([
    Promise.all([...REQUIRED_RUNTIME_FILE_ROOTS].map((relative) => readRuntimeInput(root, relative))),
    Promise.all(OPTIONAL_RUNTIME_FILE_ROOTS.map((relative) => readOptionalRuntimeInput(root, relative))),
  ])
  const files = [...requiredFiles, ...optionalFiles.filter((file) => file !== undefined)]
  return {
    directories: directories.flatMap((tree) => tree.directories).sort(compareText),
    files: [...directories.flatMap((tree) => tree.files), ...files].sort((left, right) =>
      compareText(left.path, right.path),
    ),
  }
}

type RuntimeInputHashEntry = Readonly<{ kind: 'file' | 'symlink'; path: string; sha256: string; target?: string }>

export function hashRuntimeTree(files: readonly RuntimeInputHashEntry[], directories: readonly string[]): string {
  const hash = createHash('sha256')
  hash.update('papai-story-runtime-inputs-v2\0')
  for (const directory of directories) {
    hash.update('directory\0')
    hash.update(`${Buffer.byteLength(directory)}:`)
    hash.update(directory)
    hash.update('\0')
  }
  for (const file of files) {
    const pathname = Buffer.from(file.path)
    hash.update(file.kind)
    hash.update('\0')
    hash.update(`${pathname.byteLength}:`)
    hash.update(pathname)
    hash.update('\0')
    hash.update(file.sha256)
    hash.update('\0')
    if (file.kind === 'symlink') {
      hash.update(file.target ?? '')
      hash.update('\0')
    }
  }
  return hash.digest('hex')
}
