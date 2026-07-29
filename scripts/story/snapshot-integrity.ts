// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, readlink } from 'node:fs/promises'
import path from 'node:path'

import type { StoryManifest } from './manifest.js'

export type GeneratedStorySnapshotEntry = Readonly<{ kind: 'directory'; path: 'node_modules' }>

type SnapshotEntryKind = 'directory' | 'file' | 'symlink' | 'opaque-directory'
type SnapshotControlFile = Readonly<{ path: string; sha256: string }>

function addExpectedSnapshotEntry(
  entries: Map<string, SnapshotEntryKind>,
  entryPath: string,
  kind: SnapshotEntryKind,
): void {
  const previous = entries.get(entryPath)
  if (previous !== undefined && previous !== kind) {
    throw new Error(`Snapshot integrity check failed: conflicting expected entry: ${entryPath}`)
  }
  entries.set(entryPath, kind)
}

function addExpectedSnapshotParents(entries: Map<string, SnapshotEntryKind>, entryPath: string): void {
  const parts = entryPath.split('/').slice(0, -1)
  for (let index = 1; index <= parts.length; index += 1) {
    addExpectedSnapshotEntry(entries, parts.slice(0, index).join('/'), 'directory')
  }
}

function expectedSnapshotTopology(
  manifest: StoryManifest,
  controlFile: SnapshotControlFile,
  generatedEntries: readonly GeneratedStorySnapshotEntry[],
): ReadonlyMap<string, SnapshotEntryKind> {
  const entries = new Map<string, SnapshotEntryKind>()
  for (const file of [...manifest.files, controlFile]) {
    addExpectedSnapshotParents(entries, file.path)
    addExpectedSnapshotEntry(entries, file.path, 'file')
  }
  for (const directory of manifest.runtimeInputs.directories) {
    addExpectedSnapshotParents(entries, directory)
    addExpectedSnapshotEntry(entries, directory, 'directory')
  }
  for (const input of manifest.runtimeInputs.files) {
    addExpectedSnapshotParents(entries, input.path)
    addExpectedSnapshotEntry(entries, input.path, input.kind)
  }
  for (const entry of generatedEntries) {
    addExpectedSnapshotEntry(entries, entry.path, entry.kind === 'directory' ? 'opaque-directory' : entry.kind)
  }
  return entries
}

function snapshotEntryKind(stats: Awaited<ReturnType<typeof lstat>>): SnapshotEntryKind | undefined {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  return undefined
}

function matchesExpectedKind(actual: SnapshotEntryKind | undefined, expected: SnapshotEntryKind): boolean {
  return actual === expected || (expected === 'opaque-directory' && actual === 'directory')
}

async function verifyExpectedEntries(
  snapshotRoot: string,
  expected: ReadonlyMap<string, SnapshotEntryKind>,
): Promise<void> {
  await Promise.all(
    [...expected.entries()].map(async ([entryPath, expectedKind]) => {
      const stats = await lstat(path.join(snapshotRoot, entryPath)).catch(() => undefined)
      if (stats === undefined || !matchesExpectedKind(snapshotEntryKind(stats), expectedKind)) {
        throw new Error(`Snapshot integrity check failed: ${entryPath} is not a ${expectedKind}`)
      }
    }),
  )
}

async function verifyDirectoryTopology(
  expected: ReadonlyMap<string, SnapshotEntryKind>,
  directory: string,
  relativeDirectory: string,
): Promise<void> {
  const children = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    throw new Error(`Snapshot integrity check failed: ${relativeDirectory || '.'} cannot be read safely`, {
      cause: error,
    })
  })
  const verifiedChildren = await Promise.all(
    children.map(async (child) => {
      const relative = relativeDirectory === '' ? child.name : `${relativeDirectory}/${child.name}`
      const expectedKind = expected.get(relative)
      if (expectedKind === undefined) throw new Error(`Snapshot integrity check failed: unexpected entry: ${relative}`)
      const absolute = path.join(directory, child.name)
      const stats = await lstat(absolute).catch((error: unknown) => {
        throw new Error(`Snapshot integrity check failed: ${relative} cannot be read safely`, { cause: error })
      })
      const actualKind = snapshotEntryKind(stats)
      if (!matchesExpectedKind(actualKind, expectedKind)) {
        throw new Error(`Snapshot integrity check failed: ${relative} has unexpected type`)
      }
      return { absolute, actualKind: expectedKind === 'opaque-directory' ? expectedKind : actualKind, relative }
    }),
  )
  await Promise.all(
    verifiedChildren.flatMap((child) =>
      child.actualKind === 'directory' ? [verifyDirectoryTopology(expected, child.absolute, child.relative)] : [],
    ),
  )
}

export function verifySnapshotTopology(
  snapshotRoot: string,
  manifest: StoryManifest,
  controlFile: SnapshotControlFile,
  generatedEntries: readonly GeneratedStorySnapshotEntry[] = [],
): Promise<void> {
  const expected = expectedSnapshotTopology(manifest, controlFile, generatedEntries)
  return Promise.all([
    verifyExpectedEntries(snapshotRoot, expected),
    verifyDirectoryTopology(expected, snapshotRoot, ''),
  ]).then(() => undefined)
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function assertSnapshotDirectories(snapshotRoot: string, filePath: string): Promise<void> {
  const parts = filePath.split('/').slice(0, -1)
  const directories = parts.map((_, index) => path.join(snapshotRoot, ...parts.slice(0, index + 1)))
  const statsByDirectory = await Promise.all(directories.map((directory) => lstat(directory).catch(() => undefined)))
  for (const stats of statsByDirectory) {
    if (stats === undefined || !stats.isDirectory() || stats.isSymbolicLink()) {
      throw new Error(`Snapshot integrity check failed: ${filePath} has an unsafe directory`)
    }
  }
}

export async function verifySnapshotFile(snapshotRoot: string, file: StoryManifest['files'][number]): Promise<void> {
  await assertSnapshotDirectories(snapshotRoot, file.path)
  const absolute = path.join(snapshotRoot, file.path)
  const before = await lstat(absolute).catch(() => undefined)
  if (before === undefined || !before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Snapshot integrity check failed: ${file.path} is not a regular file`)
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)
    const after = await handle.stat()
    const bytes = await handle.readFile()
    if (!after.isFile() || sha256(bytes) !== file.sha256) {
      throw new Error(`Snapshot integrity check failed: ${file.path} hash changed`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Snapshot integrity check failed')) throw error
    throw new Error(`Snapshot integrity check failed: ${file.path} cannot be read safely`, { cause: error })
  } finally {
    await handle?.close()
  }
}

export async function verifySnapshotRuntimeInput(
  snapshotRoot: string,
  input: StoryManifest['runtimeInputs']['files'][number],
): Promise<void> {
  if (input.kind === 'file') {
    await verifySnapshotFile(snapshotRoot, input)
    return
  }
  await assertSnapshotDirectories(snapshotRoot, input.path)
  const absolute = path.join(snapshotRoot, input.path)
  const entry = await lstat(absolute).catch(() => undefined)
  if (entry === undefined || !entry.isSymbolicLink()) {
    throw new Error(`Snapshot integrity check failed: ${input.path} is not a symbolic link`)
  }
  const target = await readlink(absolute).catch((error: unknown) => {
    throw new Error(`Snapshot integrity check failed: ${input.path} cannot be read safely`, { cause: error })
  })
  if (target !== input.target || sha256(target) !== input.sha256) {
    throw new Error(`Snapshot integrity check failed: ${input.path} symlink target changed`)
  }
}
