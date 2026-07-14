// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import { constants } from 'node:fs'
import type { Stats } from 'node:fs'
import path from 'node:path'

import { assertSafeDependencySymlink } from './story-dependency-snapshot-symlink.js'
import { hashDependencyTree } from './story-dependency-snapshot-tree.js'
import type { SessionFileHandle, SessionFileSystem } from './story-runner-session-reports.js'

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unsafeEntry(relative: string, kind: string): Error {
  return new Error(`Unsafe story session dependency entry: ${relative} (${kind})`)
}

function relativePath(root: string, target: string): string {
  return path.relative(root, target).split(path.sep).join('/') || '.'
}

function copyMode(stats: Stats): number {
  return (stats.mode & 0o100) === 0 ? 0o400 : 0o500
}

async function copyRegularFile(
  source: string,
  destination: string,
  relative: string,
  fs: SessionFileSystem,
): Promise<void> {
  const before = await fs.lstat(source)
  if (!before.isFile() || before.isSymbolicLink()) throw unsafeEntry(relative, 'not a regular file')
  let input: SessionFileHandle | undefined
  let output: SessionFileHandle | undefined
  try {
    input = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    const opened = await input.stat()
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw unsafeEntry(relative, 'changed while opening')
    }
    output = await fs.open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    )
    await output.writeFile(await input.readFile())
  } finally {
    await output?.close()
    await input?.close()
  }
  await fs.chmod(destination, copyMode(before))
}

async function materializeEntry(
  sourceRoot: string,
  destinationRoot: string,
  source: string,
  destination: string,
  fs: SessionFileSystem,
): Promise<void> {
  const stats = await fs.lstat(source)
  const relative = relativePath(sourceRoot, source)
  if (stats.isSymbolicLink()) {
    const target = await assertSafeDependencySymlink(sourceRoot, source, relative, fs, true)
    await fs.symlink(
      await appLocalSymlinkTarget(sourceRoot, destinationRoot, source, destination, target, fs),
      destination,
    )
    return
  }
  if (stats.isFile()) {
    await copyRegularFile(source, destination, relative, fs)
    return
  }
  if (!stats.isDirectory()) throw unsafeEntry(relative, 'special file')
  await fs.mkdir(destination, { recursive: true, mode: 0o700 })
  const entries = [...(await fs.readdir(source, { withFileTypes: true }))].sort((left, right) =>
    compareText(left.name, right.name),
  )
  await entries.reduce(
    (serial, entry) =>
      serial.then(() =>
        materializeEntry(
          sourceRoot,
          destinationRoot,
          path.join(source, entry.name),
          path.join(destination, entry.name),
          fs,
        ),
      ),
    Promise.resolve(),
  )
  await fs.chmod(destination, 0o500)
}

async function appLocalSymlinkTarget(
  sourceRoot: string,
  destinationRoot: string,
  source: string,
  destination: string,
  target: string,
  fs: SessionFileSystem,
): Promise<string> {
  if (!path.isAbsolute(target)) return target
  const sourceRealRoot = await fs.realpath(sourceRoot)
  const resolvedTarget = await fs.realpath(path.resolve(path.dirname(source), target))
  const relative = path.relative(sourceRealRoot, resolvedTarget)
  return path.relative(path.dirname(destination), path.join(destinationRoot, relative))
}

/**
 * Creates an app-local, read-only copy of a verified dependency snapshot. The
 * traversal is intentionally serial so no entire dependency tree is retained
 * in memory while constructing a runner session.
 */
export async function materializeSessionDependencies(
  sourceRoot: string,
  destinationRoot: string,
  fs: SessionFileSystem,
): Promise<string> {
  const source = await fs.lstat(sourceRoot)
  if (!source.isDirectory() || source.isSymbolicLink()) throw unsafeEntry('.', 'not a directory')
  await materializeEntry(sourceRoot, destinationRoot, sourceRoot, destinationRoot, fs)
  return hashDependencyTree(destinationRoot, fs, true)
}
