// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Stats } from 'node:fs'
import path from 'node:path'

export type SymlinkValidationDependencies = Readonly<{
  lstat(target: string): Promise<Stats>
  readlink(target: string): Promise<string>
  realpath(target: string): Promise<string>
}>

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function unsafeEntry(relative: string, kind: string): Error {
  return new Error(`Unsafe story dependency entry: ${relative} (${kind})`)
}

function assertReadOnlyEntry(stats: Stats, relative: string): void {
  if ((stats.mode & 0o222) !== 0) throw unsafeEntry(relative, 'writable entry')
}

export async function assertSafeDependencySymlink(
  root: string,
  target: string,
  relative: string,
  deps: SymlinkValidationDependencies,
  requireReadOnly: boolean,
): Promise<string> {
  const linkTarget = await deps.readlink(target)
  const resolved = await deps.realpath(path.resolve(path.dirname(target), linkTarget)).catch((error: unknown) => {
    throw new Error(`Unsafe story dependency symlink: ${relative}`, { cause: error })
  })
  const resolvedRoot = await deps.realpath(root)
  if (!isInside(resolvedRoot, resolved)) throw new Error(`Unsafe story dependency symlink: ${relative}`)
  const stats = await deps.lstat(resolved)
  if ((!stats.isFile() && !stats.isDirectory()) || stats.isSymbolicLink()) {
    throw unsafeEntry(relative, 'symlink target is not a regular file or directory')
  }
  if (requireReadOnly) assertReadOnlyEntry(stats, relative)
  return linkTarget
}
