// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'
import type { Dirent, Stats } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  open,
  readlink,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  type FileHandle,
} from 'node:fs/promises'
import path from 'node:path'

import { removeDependencyCacheTree, sealDependencyCacheTree } from './story-dependency-snapshot-cleanup.js'
import {
  installStagedDependencies,
  type StoryDependencyInstallerOptions,
} from './story-dependency-snapshot-installer.js'
import { dependencySnapshotKey } from './story-dependency-snapshot-key.js'
import { ensurePrivateDependencyCacheRoot } from './story-dependency-snapshot-root.js'
import { hashDependencyTree, safeReadDependencyFile } from './story-dependency-snapshot-tree.js'
import { loadStoryWorkspaceManifests, type StoryWorkspaceManifest } from './story-dependency-snapshot-workspaces.js'

export type { StoryDependencyInstallerOptions } from './story-dependency-snapshot-installer.js'
export type StoryDependencySnapshot = Readonly<{ key: string; root: string; treeHash: string }>

export type StoryDependencySnapshotDependencies = Readonly<{
  chmod?(target: string, mode: number): Promise<void>
  install?(options: StoryDependencyInstallerOptions): Promise<void>
  lstat?(target: string): Promise<Stats>
  mkdir?(target: string, options: Readonly<{ recursive: true; mode: number }>): Promise<string | undefined>
  open?(target: string, flags: number): Promise<FileHandle>
  readlink?(target: string): Promise<string>
  readdir?(target: string, options: Readonly<{ withFileTypes: true }>): Promise<readonly Dirent[]>
  realpath?(target: string): Promise<string>
  rename?(source: string, destination: string): Promise<void>
  rm?(target: string, options: Readonly<{ recursive: true; force: true }>): Promise<void>
  writeFile?(target: string, data: Uint8Array | string): Promise<void>
}>

type SnapshotOptions = Readonly<{ projectRoot: string; cacheRoot: string; bunVersion: string }>
type EntryManifest = Readonly<{ version: 2; key: string; bunVersion: string; treeHash: string }>
type Dependencies = Required<StoryDependencySnapshotDependencies>

const HASH = /^[a-f0-9]{64}$/u
const MANIFEST_FILE = 'manifest.json'

const defaults: Dependencies = {
  chmod,
  install: async (options): Promise<void> => {
    const child = Bun.spawn(['bun', ...options.args], {
      cwd: options.cwd,
      env: options.env,
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    })
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    if (exitCode !== 0) throw new Error(`Story dependency install failed: ${stderr.trim() || `bun exited ${exitCode}`}`)
  },
  lstat,
  mkdir,
  open,
  readlink,
  readdir: (target): Promise<readonly Dirent[]> => readdir(target, { withFileTypes: true }),
  realpath,
  rename,
  rm,
  writeFile,
}

function dependencies(overrides: StoryDependencySnapshotDependencies): Dependencies {
  return { ...defaults, ...overrides }
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function unsafeEntry(relative: string, kind: string): Error {
  return new Error(`Unsafe story dependency entry: ${relative} (${kind})`)
}

function assertReadOnlyEntry(stats: Stats, relative: string): void {
  if ((stats.mode & 0o222) !== 0) throw unsafeEntry(relative, 'writable entry')
}

function parseManifest(bytes: Uint8Array, expected: Readonly<{ key: string; bunVersion: string }>): EntryManifest {
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    throw new Error('Story dependency cache entry is invalid: manifest is not JSON', { cause: error })
  }
  if (!isRecord(value)) {
    throw new Error('Story dependency cache entry is invalid: manifest does not match the requested lock key')
  }
  const manifest = value
  const treeHash = manifest['treeHash']
  if (
    Object.keys(manifest).sort(compareText).join(',') !== 'bunVersion,key,treeHash,version' ||
    manifest['version'] !== 2 ||
    manifest['key'] !== expected.key ||
    manifest['bunVersion'] !== expected.bunVersion ||
    typeof treeHash !== 'string' ||
    !HASH.test(treeHash)
  ) {
    throw new Error('Story dependency cache entry is invalid: manifest does not match the requested lock key')
  }
  return { version: 2, key: expected.key, bunVersion: expected.bunVersion, treeHash }
}

async function verifyEntry(
  entryRoot: string,
  expected: Readonly<{ key: string; bunVersion: string }>,
  deps: Dependencies,
): Promise<StoryDependencySnapshot> {
  try {
    const entry = await deps.lstat(entryRoot)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw unsafeEntry('.', 'not a directory')
    assertReadOnlyEntry(entry, '.')
    const nodeModules = path.join(entryRoot, 'node_modules')
    const modulesEntry = await deps.lstat(nodeModules)
    if (!modulesEntry.isDirectory() || modulesEntry.isSymbolicLink())
      throw unsafeEntry('node_modules', 'not a directory')
    assertReadOnlyEntry(modulesEntry, 'node_modules')
    const manifestEntry = await deps.lstat(path.join(entryRoot, MANIFEST_FILE))
    assertReadOnlyEntry(manifestEntry, MANIFEST_FILE)
    const manifest = parseManifest(
      await safeReadDependencyFile(path.join(entryRoot, MANIFEST_FILE), MANIFEST_FILE, deps),
      expected,
    )
    const treeHash = await hashDependencyTree(nodeModules, deps, true)
    if (treeHash !== manifest.treeHash) throw new Error('tree fingerprint does not match manifest')
    return { key: expected.key, root: nodeModules, treeHash }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Story dependency cache entry is invalid')) throw error
    throw new Error(
      `Story dependency cache entry is invalid: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
    )
  }
}

async function createStagingEntry(
  staging: string,
  packageBytes: Uint8Array,
  lockBytes: Uint8Array,
  workspaceManifests: readonly StoryWorkspaceManifest[],
  expected: Readonly<{ key: string; bunVersion: string }>,
  deps: Dependencies,
): Promise<void> {
  await installStagedDependencies(staging, packageBytes, lockBytes, workspaceManifests, deps)
  const nodeModules = path.join(staging, 'node_modules')
  const treeHash = await hashDependencyTree(nodeModules, deps)
  const manifest: EntryManifest = { version: 2, ...expected, treeHash }
  await deps.writeFile(path.join(staging, MANIFEST_FILE), `${JSON.stringify(manifest)}\n`)
}

export async function acquireStoryDependencySnapshot(
  options: SnapshotOptions,
  overrides: StoryDependencySnapshotDependencies = {},
): Promise<StoryDependencySnapshot> {
  const deps = dependencies(overrides)
  const packageBytes = await safeReadDependencyFile(
    path.join(options.projectRoot, 'package.json'),
    'package.json',
    deps,
  )
  const lockBytes = await safeReadDependencyFile(path.join(options.projectRoot, 'bun.lock'), 'bun.lock', deps)
  const workspaceManifests = await loadStoryWorkspaceManifests(options.projectRoot, packageBytes, deps)
  const key = dependencySnapshotKey(packageBytes, lockBytes, options.bunVersion, workspaceManifests)
  const expected = { key, bunVersion: options.bunVersion }
  const entryRoot = path.join(options.cacheRoot, key)
  await ensurePrivateDependencyCacheRoot(options.cacheRoot, deps)
  const existing = await deps.lstat(entryRoot).catch((error: unknown) => {
    if (errorCode(error) === 'ENOENT') return undefined
    throw error
  })
  if (existing !== undefined) return verifyEntry(entryRoot, expected, deps)
  const staging = path.join(options.cacheRoot, `.${key}.${randomUUID()}`)
  await deps.mkdir(staging, { recursive: true, mode: 0o700 })
  let published = false
  try {
    await createStagingEntry(staging, packageBytes, lockBytes, workspaceManifests, expected, deps)
    await sealDependencyCacheTree(staging, deps)
    await verifyEntry(staging, expected, deps)
    try {
      await deps.rename(staging, entryRoot)
      published = true
    } catch (error) {
      if (errorCode(error) !== 'EEXIST') throw error
      await removeDependencyCacheTree(staging, deps)
      return await verifyEntry(entryRoot, expected, deps)
    }
    return await verifyEntry(entryRoot, expected, deps)
  } catch (error) {
    await removeDependencyCacheTree(published ? entryRoot : staging, deps)
    throw error
  }
}
