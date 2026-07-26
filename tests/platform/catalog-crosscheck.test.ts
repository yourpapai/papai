// tests/platform/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { repoRoot } from '../smoke/harness/docker.js'
import { catalogCoverage } from '../stories/catalog/coverage.js'
import { PLATFORM_STORIES, PLATFORM_STORY_IDS } from './scenarios/catalog.js'

describe('@3 catalog crosscheck', () => {
  test('every @3 catalog record maps one-to-one to a PLATFORM_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t3 = executable.filter((coverage) => coverage.provingTier === '3')

    expect(t3).toHaveLength(2)
    const byScenario: Map<string, readonly string[]> = new Map(
      t3.map((coverage) => [coverage.scenarioId, coverage.storyIds]),
    )
    for (const [scenarioId, storyId] of Object.entries(PLATFORM_STORY_IDS)) {
      expect(byScenario.get(scenarioId)).toEqual([storyId])
    }
    for (const coverage of t3) expect(PLATFORM_STORY_IDS[coverage.scenarioId]).toBeDefined()
  })

  test('each scenario file actually invokes its scenario id under that title', async () => {
    for (const story of Object.values(PLATFORM_STORIES)) {
      const bytes = await Bun.file(`${repoRoot()}${story.file}`).text()
      expect(bytes.includes(`title('${story.scenarioId}')`)).toBe(true)
    }
  })
})
