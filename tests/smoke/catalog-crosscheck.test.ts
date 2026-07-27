// tests/smoke/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { catalogCoverage } from '../stories/catalog/coverage.js'
import { repoRoot } from './harness/docker.js'
import { SMOKE_STORIES, SMOKE_STORY_IDS } from './scenarios/catalog.js'

describe('@2 catalog crosscheck', () => {
  test('every @2 catalog record maps one-to-one to a SMOKE_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t2 = executable.filter((coverage) => coverage.provingTier === '2')

    expect(t2).toHaveLength(8)
    const byScenario: Map<string, readonly string[]> = new Map(
      t2.map((coverage) => [coverage.scenarioId, coverage.storyIds]),
    )
    for (const [scenarioId, storyId] of Object.entries(SMOKE_STORY_IDS)) {
      expect(byScenario.get(scenarioId)).toEqual([storyId])
    }
    // Reverse direction: no @2 catalog record lacks a candidate registry entry.
    for (const coverage of t2) expect(SMOKE_STORY_IDS[coverage.scenarioId]).toBeDefined()
  })

  test('each scenario file actually invokes its scenario id under that title', async () => {
    for (const story of Object.values(SMOKE_STORIES)) {
      const bytes = await Bun.file(`${repoRoot()}${story.file}`).text()
      expect(bytes.includes(`title('${story.scenarioId}')`)).toBe(true)
    }
  })
})
