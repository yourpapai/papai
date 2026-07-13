// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dirent } from 'node:fs'
import path from 'node:path'

type TreeStats = Readonly<{ isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean; mode: number }>

export type DependencyCacheTreeDependencies = Readonly<{
  chmod(target: string, mode: number): Promise<void>
  lstat(target: string): Promise<TreeStats>
  readdir(target: string, options: Readonly<{ withFileTypes: true }>): Promise<readonly Dirent[]>
  rm(target: string, options: Readonly<{ recursive: true; force: true }>): Promise<void>
}>

export async function sealDependencyCacheTree(root: string, deps: DependencyCacheTreeDependencies): Promise<void> {
  const entries = await deps.readdir(root, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry): Promise<void> => {
      const target = path.join(root, entry.name)
      const stats = await deps.lstat(target)
      if (stats.isDirectory() && !stats.isSymbolicLink()) {
        await sealDependencyCacheTree(target, deps)
        await deps.chmod(target, 0o500)
      } else if (stats.isFile() && !stats.isSymbolicLink()) {
        await deps.chmod(target, (stats.mode & 0o100) === 0 ? 0o400 : 0o500)
      }
    }),
  )
  await deps.chmod(root, 0o500)
}

async function makeDependencyCacheTreeRemovable(root: string, deps: DependencyCacheTreeDependencies): Promise<void> {
  const entries = await deps.readdir(root, { withFileTypes: true }).catch(() => [])
  await Promise.all(
    entries.map(async (entry): Promise<void> => {
      const target = path.join(root, entry.name)
      const stats = await deps.lstat(target).catch(() => undefined)
      if (stats !== undefined && stats.isDirectory() && !stats.isSymbolicLink()) {
        await makeDependencyCacheTreeRemovable(target, deps)
      }
    }),
  )
  await deps.chmod(root, 0o700).catch(() => undefined)
}

export async function removeDependencyCacheTree(root: string, deps: DependencyCacheTreeDependencies): Promise<void> {
  await makeDependencyCacheTreeRemovable(root, deps)
  await deps.rm(root, { recursive: true, force: true })
}
