// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { withSourceParser } from '../../../src/ts-ast/source-parser.js'
import { censusTier, type StoryCensus } from '../../stories/catalog/census.js'
import type { StoryTier } from '../../stories/catalog/coverage.js'
import { repoRoot } from './docker.js'
import { scanStoryMarkers } from './story-markers.js'

export type MarkedLaneCensus = Readonly<{
  census: StoryCensus
  /** Marker keys with no registry entry: the scenario runs, but no lane record names it. */
  unregistered: readonly string[]
  /** Tests that named themselves without going through the `title()` helper. */
  violations: readonly string[]
}>

/**
 * Discovery is by glob, not by walking the registry: a scenario file nobody
 * registered has to be visible, and iterating the registry would never see it.
 */
export async function censusMarkedLane(
  input: Readonly<{ tier: StoryTier; glob: string; registry: Readonly<Record<string, string>> }>,
): Promise<MarkedLaneCensus> {
  const observed: string[] = []
  const unregistered: string[] = []
  const violations: string[] = []

  await withSourceParser(async (parser) => {
    for await (const file of new Bun.Glob(input.glob).scan({ cwd: repoRoot() })) {
      const scan = await scanStoryMarkers(parser, file, await Bun.file(`${repoRoot()}${file}`).text())
      violations.push(...scan.violations)
      for (const key of scan.keys) {
        const storyId = input.registry[key]
        if (storyId === undefined) unregistered.push(`${file}#${key}`)
        else observed.push(storyId)
      }
    }
  })

  return Object.freeze({ census: censusTier(input.tier, observed), unregistered, violations })
}
