// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { StoryDependencyPlatform } from './story-dependency-snapshot-key.js'
import type { StoryWorkspaceManifest } from './story-dependency-snapshot-workspaces.js'

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
