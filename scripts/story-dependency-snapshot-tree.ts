// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, type Hash } from 'node:crypto'
import { constants } from 'node:fs'
import type { Dirent, Stats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { assertSafeDependencySymlink } from './story-dependency-snapshot-symlink.js'

export type DependencyTreeDependencies = Readonly<{
  lstat(target: string): Promise<Stats>
  open(target: string, flags: number): Promise<FileHandle>
  readlink(target: string): Promise<string>
  readdir(target: string, options: Readonly<{ withFileTypes: true }>): Promise<readonly Dirent[]>
  realpath(target: string): Promise<string>
}>

type DependencyTreeEntry = Readonly<
  | { kind: 'directory'; path: string }
  | { kind: 'file'; path: string; target: string }
  | { kind: 'symlink'; path: string; target: string }
>

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/')
}

function unsafeEntry(relative: string, kind: string): Error {
  return new Error(`Unsafe story dependency entry: ${relative} (${kind})`)
}

function assertReadOnlyEntry(stats: Stats, relative: string): void {
  if ((stats.mode & 0o222) !== 0) throw unsafeEntry(relative, 'writable entry')
}

export async function safeReadDependencyFile(
  target: string,
  relative: string,
  deps: DependencyTreeDependencies,
): Promise<Uint8Array> {
  const before = await deps.lstat(target)
  if (!before.isFile() || before.isSymbolicLink()) throw unsafeEntry(relative, 'not a regular file')
  let handle: FileHandle | undefined
  try {
    handle = await deps.open(target, constants.O_RDONLY | constants.O_NOFOLLOW)
    const after = await handle.stat()
    if (!after.isFile()) throw unsafeEntry(relative, 'not a regular file')
    return await handle.readFile()
  } catch (error) {
    if (errorCode(error) === 'ELOOP') throw unsafeEntry(relative, 'symbolic link')
    throw error
  } finally {
    await handle?.close()
  }
}

async function collectDependencyTree(
  root: string,
  directory: string,
  deps: DependencyTreeDependencies,
  requireReadOnly: boolean,
): Promise<DependencyTreeEntry[]> {
  const entries = [...(await deps.readdir(directory, { withFileTypes: true }))].sort((left, right) =>
    compareText(left.name, right.name),
  )
  const collected: DependencyTreeEntry[] = []
  await entries.reduce(
    (serial, entry) =>
      serial.then(() => collectDependencyEntry(root, directory, entry, deps, requireReadOnly, collected)),
    Promise.resolve(),
  )
  return collected
}

async function collectDependencyEntry(
  root: string,
  directory: string,
  entry: Dirent,
  deps: DependencyTreeDependencies,
  requireReadOnly: boolean,
  collected: DependencyTreeEntry[],
): Promise<void> {
  const target = path.join(directory, entry.name)
  const relative = toPosix(path.relative(root, target))
  const stats = await deps.lstat(target)
  if (stats.isSymbolicLink()) {
    collected.push({
      kind: 'symlink',
      path: relative,
      target: await assertSafeDependencySymlink(root, target, relative, deps, requireReadOnly),
    })
  } else if (stats.isDirectory()) {
    if (requireReadOnly) assertReadOnlyEntry(stats, relative)
    collected.push({ kind: 'directory', path: relative })
    collected.push(...(await collectDependencyTree(root, target, deps, requireReadOnly)))
  } else if (stats.isFile()) {
    if (requireReadOnly) assertReadOnlyEntry(stats, relative)
    collected.push({ kind: 'file', path: relative, target })
  } else {
    throw unsafeEntry(relative, 'special file')
  }
}

function updateFramedBytes(hash: Hash, bytes: Uint8Array): void {
  hash.update(String(bytes.byteLength))
  hash.update('\0')
  hash.update(bytes)
  hash.update('\0')
}

export async function hashDependencyTree(
  root: string,
  deps: DependencyTreeDependencies,
  requireReadOnly = false,
): Promise<string> {
  const hash = createHash('sha256')
  hash.update('papai-story-dependency-tree-v1\0')
  const entries = await collectDependencyTree(root, root, deps, requireReadOnly)
  await entries
    .sort((left, right) => compareText(left.path, right.path))
    .reduce((serial, entry) => serial.then(() => hashDependencyEntry(hash, entry, deps)), Promise.resolve())
  return hash.digest('hex')
}

async function hashDependencyEntry(
  hash: Hash,
  entry: DependencyTreeEntry,
  deps: DependencyTreeDependencies,
): Promise<void> {
  hash.update(`${entry.kind}\0${entry.path}\0`)
  if (entry.kind === 'file') updateFramedBytes(hash, await safeReadDependencyFile(entry.target, entry.path, deps))
  else if (entry.kind === 'symlink') updateFramedBytes(hash, Buffer.from(entry.target))
}
