// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dirent, Stats } from 'node:fs'
import { chmod, lstat, readdir, rm } from 'node:fs/promises'
import path from 'node:path'

import { removeDependencyCacheTree } from './dependencies-tree.js'

export type DependencyCacheRootDependencies = Readonly<{
  chmod(target: string, mode: number): Promise<void>
  lstat(target: string): Promise<Stats>
  mkdir(target: string, options: Readonly<{ recursive: true; mode: number }>): Promise<string | undefined>
}>

export type DependencyCachePruneDependencies = Readonly<{
  chmod?(target: string, mode: number): Promise<void>
  lstat?(target: string): Promise<Stats>
  readdir?(target: string, options: Readonly<{ withFileTypes: true }>): Promise<readonly Dirent[]>
  rm?(target: string, options: Readonly<{ recursive: true; force: true }>): Promise<void>
}>

type ResolvedPruneDependencies = Required<DependencyCachePruneDependencies>

const HASH = /^[a-f0-9]{64}$/u
const DEFAULT_CACHE_KEEP = 3

const pruneDefaults: ResolvedPruneDependencies = {
  chmod,
  lstat,
  readdir: (target): Promise<readonly Dirent[]> => readdir(target, { withFileTypes: true }),
  rm,
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
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

export function resolveDependencyCacheKeep(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): number {
  const raw = environment['PAPAI_STORY_DEPENDENCY_CACHE_KEEP']
  if (raw === undefined || !/^\d+$/u.test(raw.trim())) return DEFAULT_CACHE_KEEP
  const parsed = Number.parseInt(raw.trim(), 10)
  return parsed > 0 ? parsed : DEFAULT_CACHE_KEEP
}

export async function pruneDependencyCacheEntries(
  cacheRoot: string,
  currentKey: string,
  overrides: DependencyCachePruneDependencies = {},
  keep: number = resolveDependencyCacheKeep(),
): Promise<void> {
  const deps: ResolvedPruneDependencies = { ...pruneDefaults, ...overrides }
  try {
    const entries = (await deps.readdir(cacheRoot, { withFileTypes: true })).filter(
      (entry) => entry.isDirectory() && HASH.test(entry.name),
    )
    if (entries.length <= keep) return
    const decorated = await Promise.all(
      entries.map(async (entry) => ({
        name: entry.name,
        mtimeMs: (await deps.lstat(path.join(cacheRoot, entry.name))).mtimeMs,
      })),
    )
    decorated.sort((left, right) => right.mtimeMs - left.mtimeMs || compareText(left.name, right.name))
    const kept = new Set([currentKey, ...decorated.slice(0, keep).map((entry) => entry.name)])
    await Promise.all(
      decorated
        .slice(keep)
        .filter((entry) => !kept.has(entry.name))
        .map((entry) => removeDependencyCacheTree(path.join(cacheRoot, entry.name), deps)),
    )
  } catch (error) {
    console.warn(`Story dependency cache prune skipped: ${error instanceof Error ? error.message : String(error)}`)
  }
}
