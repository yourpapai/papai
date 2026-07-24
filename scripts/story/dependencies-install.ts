// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash } from 'node:crypto'
import path from 'node:path'

import type { DependencyTreeDependencies } from './dependencies-tree.js'
import { safeReadDependencyFile } from './dependencies-tree.js'

export type StoryDependencyPlatform = Readonly<{ os: string; cpu: string }>

function frame(bytes: Uint8Array): Uint8Array {
  return Buffer.concat([Buffer.from(String(bytes.byteLength)), Buffer.from('\0'), bytes, Buffer.from('\0')])
}

export function dependencySnapshotKey(
  packageBytes: Uint8Array,
  lockBytes: Uint8Array,
  bunVersion: string,
  workspaceManifests: ReadonlyArray<Readonly<{ path: string; bytes: Uint8Array }>> = [],
  platform: StoryDependencyPlatform = { os: process.platform, cpu: process.arch },
): string {
  const hash = createHash('sha256')
  hash.update('papai-story-dependency-key-v4\0')
  for (const value of [packageBytes, lockBytes, Buffer.from(bunVersion)]) hash.update(frame(value))
  for (const workspace of workspaceManifests) {
    hash.update(frame(Buffer.from(workspace.path)))
    hash.update(frame(workspace.bytes))
  }
  hash.update(frame(Buffer.from(platform.os)))
  hash.update(frame(Buffer.from(platform.cpu)))
  return hash.digest('hex')
}

export type StoryWorkspaceManifest = Readonly<{ path: string; bytes: Uint8Array }>

type WorkspaceManifestFileSystem = Pick<
  DependencyTreeDependencies,
  'lstat' | 'open' | 'readlink' | 'readdir' | 'realpath'
>

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const entries: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) entries[key] = entry
  return entries
}

function workspacePaths(packageBytes: Uint8Array): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(packageBytes))
  } catch (error) {
    throw new Error('Story dependency package.json is not valid JSON', { cause: error })
  }
  const packageJson = record(parsed)
  if (packageJson === undefined) return []
  const workspaces = packageJson['workspaces']
  const values = Array.isArray(workspaces) ? workspaces : record(workspaces)?.['packages']
  if (values === undefined) return []
  if (!Array.isArray(values) || !values.every((value): value is string => typeof value === 'string')) {
    throw new Error('Story dependency workspaces must be an array of paths')
  }
  return [...new Set(values)].sort(compareText)
}

function workspacePackagePath(workspace: string): string {
  const normalized = path.posix.normalize(workspace)
  if (
    workspace.includes('\\') ||
    workspace.includes('*') ||
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    path.isAbsolute(workspace) ||
    path.win32.isAbsolute(workspace)
  ) {
    throw new Error(`Unsafe story dependency workspace path: ${workspace}`)
  }
  return `${normalized}/package.json`
}

async function assertWorkspaceDirectories(
  projectRoot: string,
  packagePath: string,
  fs: WorkspaceManifestFileSystem,
): Promise<void> {
  const segments = packagePath.split('/').slice(0, -1)
  const directories = segments
    .reduce<readonly string[]>(
      (paths, segment) => [...paths, path.join(paths.at(-1) ?? projectRoot, segment)],
      [projectRoot],
    )
    .slice(1)
  const entries = await Promise.all(directories.map((directory) => fs.lstat(directory)))
  if (entries.some((entry) => !entry.isDirectory() || entry.isSymbolicLink())) {
    throw new Error(`Unsafe story dependency workspace path: ${packagePath}`)
  }
}

export function loadStoryWorkspaceManifests(
  projectRoot: string,
  packageBytes: Uint8Array,
  fs: WorkspaceManifestFileSystem,
): Promise<readonly StoryWorkspaceManifest[]> {
  const paths = workspacePaths(packageBytes).map(workspacePackagePath)
  return Promise.all(
    paths.map(async (workspacePath) => {
      await assertWorkspaceDirectories(projectRoot, workspacePath, fs)
      return {
        path: workspacePath,
        bytes: await safeReadDependencyFile(path.join(projectRoot, workspacePath), workspacePath, fs),
      }
    }),
  )
}

export type StoryDependencyInstallerOptions = Readonly<{
  args: readonly string[]
  cwd: string
  env: Readonly<Record<string, string>>
  stderr: 'pipe'
  stdin: 'ignore'
  stdout: 'ignore'
}>

export type StagingInstallerDependencies = Readonly<{
  install(options: StoryDependencyInstallerOptions): Promise<void>
  mkdir(target: string, options: Readonly<{ recursive: true; mode: number }>): Promise<string | undefined>
  rm(target: string, options: Readonly<{ recursive: true; force: true }>): Promise<void>
  writeFile(target: string, data: Uint8Array | string): Promise<void>
}>

function installEnvironment(staging: string): Readonly<Record<string, string>> {
  return {
    PATH: process.env['PATH'] ?? '',
    HOME: path.join(staging, '.home'),
    TMPDIR: path.join(staging, '.tmp'),
    BUN_INSTALL_CACHE_DIR: path.join(staging, '.bun-cache'),
  }
}

export async function installStagedDependencies(
  staging: string,
  packageBytes: Uint8Array,
  lockBytes: Uint8Array,
  workspaceManifests: readonly StoryWorkspaceManifest[],
  deps: StagingInstallerDependencies,
  platform: StoryDependencyPlatform,
): Promise<void> {
  const env = installEnvironment(staging)
  await Promise.all(
    Object.values(env)
      .slice(1)
      .map((directory) => deps.mkdir(directory, { recursive: true, mode: 0o700 })),
  )
  await deps.writeFile(path.join(staging, 'package.json'), packageBytes)
  await deps.writeFile(path.join(staging, 'bun.lock'), lockBytes)
  await Promise.all(
    workspaceManifests.map(async (workspace) => {
      await deps.mkdir(path.dirname(path.join(staging, workspace.path)), { recursive: true, mode: 0o700 })
      await deps.writeFile(path.join(staging, workspace.path), workspace.bytes)
    }),
  )
  await deps.install({
    args: ['install', '--frozen-lockfile', '--backend=copyfile', `--os=${platform.os}`, `--cpu=${platform.cpu}`],
    cwd: staging,
    env,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
  })
  await Promise.all([
    ...Object.values(env)
      .slice(1)
      .map((directory) => deps.rm(directory, { recursive: true, force: true })),
    deps.rm(path.join(staging, 'package.json'), { recursive: true, force: true }),
    deps.rm(path.join(staging, 'bun.lock'), { recursive: true, force: true }),
    ...workspaceManifests.map((workspace) =>
      deps.rm(path.join(staging, workspace.path), { recursive: true, force: true }),
    ),
  ])
  const workspaceDirectories = [
    ...new Set(workspaceManifests.map((workspace) => path.dirname(path.join(staging, workspace.path)))),
  ]
  workspaceDirectories.sort((left, right) => right.length - left.length)
  await workspaceDirectories.reduce(
    (serial, directory) => serial.then(() => deps.rm(directory, { recursive: true, force: true })),
    Promise.resolve(),
  )
}
