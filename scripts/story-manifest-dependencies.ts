// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { homedir } from 'node:os'
import path from 'node:path'

import { acquireStoryDependencySnapshot, type StoryDependencySnapshot } from './story-dependency-snapshot.js'

export type CandidateStoryManifestDependencies = Readonly<{
  acquireDependencySnapshot?(
    options: Readonly<{ projectRoot: string; cacheRoot: string; bunVersion: string }>,
  ): Promise<StoryDependencySnapshot>
}>

function dependencyCacheRoot(): string {
  return process.env['PAPAI_STORY_DEPENDENCY_CACHE_ROOT'] ?? path.join(homedir(), '.cache', 'papai-story-dependencies')
}

export function acquireCandidateDependencySnapshot(
  root: string,
  bunVersion: string,
  dependencies: CandidateStoryManifestDependencies,
): Promise<StoryDependencySnapshot> {
  const acquire = dependencies.acquireDependencySnapshot ?? acquireStoryDependencySnapshot
  return acquire({ projectRoot: root, cacheRoot: dependencyCacheRoot(), bunVersion })
}
