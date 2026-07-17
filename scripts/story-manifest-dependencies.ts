// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { homedir } from 'node:os'
import path from 'node:path'

import type { StoryDependencyPlatform } from './story-dependency-snapshot-key.js'
import { acquireStoryDependencySnapshot, type StoryDependencySnapshot } from './story-dependency-snapshot.js'
import {
  STORY_SANDBOX_LINUX_IMAGE,
  type StorySandboxProcessResult,
  type StorySandboxProcessRunner,
} from './story-sandbox-linux.js'

export type CandidateStoryManifestDependencies = Readonly<{
  acquireDependencySnapshot?(
    options: Readonly<{
      projectRoot: string
      cacheRoot: string
      bunVersion: string
      platform: StoryDependencyPlatform
    }>,
  ): Promise<StoryDependencySnapshot>
  inspectDependencyPlatform?(): Promise<StoryDependencyPlatform>
}>

function dependencyCacheRoot(): string {
  return process.env['PAPAI_STORY_DEPENDENCY_CACHE_ROOT'] ?? path.join(homedir(), '.cache', 'papai-story-dependencies')
}

export function hostStoryDependencyPlatform(): StoryDependencyPlatform {
  return { os: process.platform === 'win32' ? 'windows' : process.platform, cpu: process.arch }
}

const DOCKER_CPU: Readonly<Record<string, string>> = { amd64: 'x64', arm64: 'arm64' }

function defaultProcessRunner(command: readonly string[]): StorySandboxProcessResult {
  const child = Bun.spawnSync([...command], { stdout: 'pipe', stderr: 'pipe' })
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() }
}

export function resolveStoryDependencyPlatform(
  run: StorySandboxProcessRunner = defaultProcessRunner,
): Promise<StoryDependencyPlatform> {
  const result = run(['docker', 'image', 'inspect', STORY_SANDBOX_LINUX_IMAGE, '--format', '{{.Os}}/{{.Architecture}}'])
  if (result.exitCode !== 0) return Promise.resolve(hostStoryDependencyPlatform())
  const [osName, architecture] = result.stdout.trim().split('/')
  const cpu = architecture === undefined ? undefined : DOCKER_CPU[architecture]
  if (osName !== 'linux' || cpu === undefined) return Promise.resolve(hostStoryDependencyPlatform())
  return Promise.resolve({ os: osName, cpu })
}

export async function acquireCandidateDependencySnapshot(
  root: string,
  bunVersion: string,
  dependencies: CandidateStoryManifestDependencies,
): Promise<StoryDependencySnapshot> {
  const acquire = dependencies.acquireDependencySnapshot ?? acquireStoryDependencySnapshot
  const platform = await (dependencies.inspectDependencyPlatform ?? resolveStoryDependencyPlatform)()
  return acquire({ projectRoot: root, cacheRoot: dependencyCacheRoot(), bunVersion, platform })
}
