// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { lstat, readdir } from 'node:fs/promises'
import path from 'node:path'

import type { StoryManifest } from './story-manifest.js'

type SnapshotEntryKind = 'directory' | 'file' | 'symlink'
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
  return entries
}

function snapshotEntryKind(stats: Awaited<ReturnType<typeof lstat>>): SnapshotEntryKind | undefined {
  if (stats.isSymbolicLink()) return 'symlink'
  if (stats.isDirectory()) return 'directory'
  if (stats.isFile()) return 'file'
  return undefined
}

async function verifyExpectedEntries(
  snapshotRoot: string,
  expected: ReadonlyMap<string, SnapshotEntryKind>,
): Promise<void> {
  await Promise.all(
    [...expected.entries()].map(async ([entryPath, expectedKind]) => {
      const stats = await lstat(path.join(snapshotRoot, entryPath)).catch(() => undefined)
      if (stats === undefined || snapshotEntryKind(stats) !== expectedKind) {
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
      if (actualKind !== expectedKind) {
        throw new Error(`Snapshot integrity check failed: ${relative} has unexpected type`)
      }
      return { absolute, actualKind, relative }
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
): Promise<void> {
  const expected = expectedSnapshotTopology(manifest, controlFile)
  return Promise.all([
    verifyExpectedEntries(snapshotRoot, expected),
    verifyDirectoryTopology(expected, snapshotRoot, ''),
  ]).then(() => undefined)
}
