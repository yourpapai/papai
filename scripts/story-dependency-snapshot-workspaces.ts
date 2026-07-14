// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.

import path from 'node:path'

import type { DependencyTreeDependencies } from './story-dependency-snapshot-tree.js'
import { safeReadDependencyFile } from './story-dependency-snapshot-tree.js'

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
