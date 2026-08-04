// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { compareText, isCapturedStoryInputPath, type LoadedStoryFile } from './inputs.js'
import {
  assertRuntimeSymlinkTarget,
  isRuntimeInputPath,
  OPTIONAL_RUNTIME_DIRECTORY_ROOTS,
  REQUIRED_RUNTIME_DIRECTORY_ROOTS,
  REQUIRED_RUNTIME_FILE_ROOTS,
  type LoadedRuntimeInput,
  type LoadedRuntimeInputTree,
} from './runtime-inputs.js'

const STORIES_PREFIX = 'tests/stories'
const GIT_BLOB_CONCURRENCY = 16

async function gitBytes(root: string, args: readonly string[], context: string): Promise<Uint8Array> {
  const child = Bun.spawn(['git', ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ])
  if (exitCode !== 0) throw new Error(`${context}: ${stderr.trim() || `git exited ${exitCode}`}`)
  return new Uint8Array(stdout)
}

export async function resolveStoryManifestCommit(root: string, ref: string): Promise<string> {
  if (ref.trim() === '') throw new Error('Compatibility mode requires an explicit baseline ref')
  try {
    const bytes = await gitBytes(
      root,
      ['rev-parse', '--verify', `${ref}^{commit}`],
      `Cannot resolve baseline ref "${ref}"`,
    )
    return new TextDecoder().decode(bytes).trim()
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Cannot resolve baseline ref')) throw error
    throw new Error(`Cannot resolve baseline ref "${ref}"`, { cause: error })
  }
}

export async function currentStoryManifestCommit(root: string): Promise<string> {
  const bytes = await gitBytes(root, ['rev-parse', '--verify', 'HEAD^{commit}'], 'Cannot resolve candidate HEAD')
  return new TextDecoder().decode(bytes).trim()
}

type GitTreeEntry = Readonly<{ mode: string; object: string; path: string }>

function parseGitTree(
  bytes: Uint8Array,
  selected: (filePath: string) => boolean,
  allowSymlinks: boolean,
): readonly GitTreeEntry[] {
  const records = new TextDecoder().decode(bytes).split('\0').filter(Boolean)
  return records.flatMap((record): readonly GitTreeEntry[] => {
    const tab = record.indexOf('\t')
    const metadata = record.slice(0, tab).split(' ')
    const mode = metadata[0]
    const type = metadata[1]
    const object = metadata[2]
    const pathname = record.slice(tab + 1)
    if (!selected(pathname)) return []
    if (tab < 0 || mode === undefined || object === undefined || type !== 'blob') {
      throw new Error(`Malformed Git tree entry for ${pathname || STORIES_PREFIX}`)
    }
    if (mode !== '100644' && mode !== '100755' && (!allowSymlinks || mode !== '120000')) {
      throw new Error(`Unsupported story manifest entry at baseline: ${pathname} (mode ${mode})`)
    }
    return [{ mode, object, path: pathname }]
  })
}

async function loadBaselineFiles(
  root: string,
  commit: string,
  paths: readonly string[],
  selected: (filePath: string) => boolean,
  allowSymlinks = false,
): Promise<readonly LoadedStoryFile[]> {
  const tree = await gitBytes(
    root,
    ['ls-tree', '-rz', '--full-tree', commit, '--', ...paths],
    `Cannot read story inputs at ${commit}`,
  )
  const entries = [...parseGitTree(tree, selected, allowSymlinks)].sort((left, right) =>
    compareText(left.path, right.path),
  )
  const limit = pLimit(GIT_BLOB_CONCURRENCY)
  return Promise.all(
    entries.map((entry) =>
      limit(
        async (): Promise<LoadedStoryFile> => ({
          path: entry.path,
          bytes: await gitBytes(root, ['cat-file', 'blob', entry.object], `Cannot read baseline blob ${entry.path}`),
        }),
      ),
    ),
  )
}

export function loadBaselineStoryFiles(root: string, commit: string): Promise<readonly LoadedStoryFile[]> {
  return loadBaselineFiles(root, commit, ['bunfig.toml', 'tests', 'scripts'], isCapturedStoryInputPath)
}

const RUNTIME_DIRECTORY_ROOTS = new Set<string>([
  ...REQUIRED_RUNTIME_DIRECTORY_ROOTS,
  ...OPTIONAL_RUNTIME_DIRECTORY_ROOTS,
])

function runtimeDirectories(paths: readonly string[]): readonly string[] {
  const directories = new Set<string>()
  for (const filePath of paths) {
    const parts = filePath.split('/').slice(0, -1)
    const root = parts[0]
    if (root === undefined || !RUNTIME_DIRECTORY_ROOTS.has(root)) continue
    for (let index = 1; index <= parts.length; index += 1) directories.add(parts.slice(0, index).join('/'))
  }
  return [...directories].sort(compareText)
}

export async function loadBaselineRuntimeInputs(root: string, commit: string): Promise<LoadedRuntimeInputTree> {
  const tree = await gitBytes(
    root,
    [
      'ls-tree',
      '-rz',
      '--full-tree',
      commit,
      '--',
      'src',
      'plugins',
      'package.json',
      'bun.lock',
      'public',
      'docs/architecture/behaviors.md',
    ],
    `Cannot read story runtime inputs at ${commit}`,
  )
  const entries = [...parseGitTree(tree, isRuntimeInputPath, true)].sort((left, right) =>
    compareText(left.path, right.path),
  )
  const paths = entries.map((entry) => entry.path)
  const missing = [
    ...REQUIRED_RUNTIME_DIRECTORY_ROOTS.filter(
      (directory) => !paths.some((filePath) => filePath.startsWith(`${directory}/`)),
    ),
    ...REQUIRED_RUNTIME_FILE_ROOTS.filter((filePath) => !paths.includes(filePath)),
  ]
  if (missing.length > 0) throw new Error(`Baseline runtime inputs missing: ${missing.join(', ')}`)
  const limit = pLimit(GIT_BLOB_CONCURRENCY)
  const files = await Promise.all(
    entries.map((entry) =>
      limit(async (): Promise<LoadedRuntimeInput> => {
        const bytes = await gitBytes(
          root,
          ['cat-file', 'blob', entry.object],
          `Cannot read baseline blob ${entry.path}`,
        )
        if (entry.mode !== '120000') return { kind: 'file', path: entry.path, bytes }
        const target = new TextDecoder().decode(bytes)
        assertRuntimeSymlinkTarget(root, entry.path, target)
        return { kind: 'symlink', path: entry.path, target }
      }),
    ),
  )
  return { directories: runtimeDirectories(paths), files }
}
