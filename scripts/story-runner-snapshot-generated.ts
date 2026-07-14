// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import { lstat, mkdir, readlink, symlink } from 'node:fs/promises'
import path from 'node:path'

export type GeneratedStorySnapshotSymlink = Readonly<{
  kind: 'symlink'
  path: 'node_modules'
  target: '../node_modules'
}>

export type GeneratedStorySnapshotDirectory = Readonly<{ kind: 'directory'; path: 'node_modules' }>

export type GeneratedStorySnapshotEntry = GeneratedStorySnapshotDirectory | GeneratedStorySnapshotSymlink

async function writeGeneratedSymlink(root: string, link: GeneratedStorySnapshotSymlink): Promise<void> {
  if (link.target !== '../node_modules') {
    throw new Error('Story generated dependency link must target the session dependency snapshot')
  }
  await symlink(link.target, path.join(root, link.path))
}

export async function writeGeneratedStorySnapshotEntry(
  root: string,
  entry: GeneratedStorySnapshotEntry,
): Promise<void> {
  if (entry.kind === 'directory') {
    await mkdir(path.join(root, entry.path), { recursive: true })
    return
  }
  await writeGeneratedSymlink(root, entry)
}

async function verifyGeneratedSnapshotSymlink(
  snapshotRoot: string,
  link: GeneratedStorySnapshotSymlink,
): Promise<void> {
  const absolute = path.join(snapshotRoot, link.path)
  const entry = await lstat(absolute).catch(() => undefined)
  if (entry === undefined || !entry.isSymbolicLink()) {
    throw new Error(`Snapshot integrity check failed: ${link.path} is not a symbolic link`)
  }
  const target = await readlink(absolute).catch((error: unknown) => {
    throw new Error(`Snapshot integrity check failed: ${link.path} cannot be read safely`, { cause: error })
  })
  if (target !== link.target) throw new Error(`Snapshot integrity check failed: ${link.path} target changed`)
}

export function generatedStorySnapshotVerifications(
  snapshotRoot: string,
  entries: readonly GeneratedStorySnapshotEntry[],
): readonly Promise<void>[] {
  return entries
    .filter((entry): entry is GeneratedStorySnapshotSymlink => entry.kind === 'symlink')
    .map((link) => verifyGeneratedSnapshotSymlink(snapshotRoot, link))
}
