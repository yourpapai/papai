// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Stats } from 'node:fs'

export type DependencyCacheRootDependencies = Readonly<{
  chmod(target: string, mode: number): Promise<void>
  lstat(target: string): Promise<Stats>
  mkdir(target: string, options: Readonly<{ recursive: true; mode: number }>): Promise<string | undefined>
}>

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function isOwnedByCurrentUser(stats: Stats): boolean {
  const getuid = process.getuid
  return getuid === undefined || stats.uid === getuid.call(process)
}

function assertPrivateCacheRoot(root: string, stats: Stats): void {
  if (!stats.isDirectory() || stats.isSymbolicLink() || !isOwnedByCurrentUser(stats) || (stats.mode & 0o077) !== 0) {
    throw new Error(`Unsafe story dependency cache root: ${root}`)
  }
}

export async function ensurePrivateDependencyCacheRoot(
  root: string,
  deps: DependencyCacheRootDependencies,
): Promise<void> {
  const existing = await deps.lstat(root).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  })
  if (existing === undefined) await deps.mkdir(root, { recursive: true, mode: 0o700 })
  const stats = await deps.lstat(root)
  assertPrivateCacheRoot(root, stats)
  await deps.chmod(root, 0o700)
}
