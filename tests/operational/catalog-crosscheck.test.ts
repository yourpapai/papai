// tests/operational/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { repoRoot } from '../smoke/harness/docker.js'
import { censusMarkedLane } from '../smoke/harness/lane-census.js'
import { catalogCoverage } from '../stories/catalog/coverage.js'
import { OPERATIONAL_STORIES, OPERATIONAL_STORY_IDS } from './scenarios/catalog.js'

describe('@4 catalog crosscheck', () => {
  test('every @4 catalog record maps one-to-one to an OPERATIONAL_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t4 = executable.filter((coverage) => coverage.provingTier === '4')

    expect(t4).toHaveLength(1)
    const byScenario: Map<string, readonly string[]> = new Map(
      t4.map((coverage) => [coverage.scenarioId, coverage.storyIds]),
    )
    for (const [scenarioId, storyId] of Object.entries(OPERATIONAL_STORY_IDS)) {
      expect(byScenario.get(scenarioId)).toEqual([storyId])
    }
    // Reverse direction: no @4 catalog record lacks a candidate registry entry.
    for (const coverage of t4) expect(OPERATIONAL_STORY_IDS[coverage.scenarioId]).toBeDefined()
  })

  test('each scenario file actually invokes its scenario id under that title', async () => {
    for (const story of Object.values(OPERATIONAL_STORIES)) {
      const bytes = await Bun.file(`${repoRoot()}${story.file}`).text()
      expect(bytes.includes(`title('${story.scenarioId}')`)).toBe(true)
    }
  })

  test('every @4 scenario marker is registered and claimed, and none bypasses title()', async () => {
    const { census, unregistered, violations } = await censusMarkedLane({
      tier: '4',
      glob: 'tests/operational/scenarios/*.operational.ts',
      registry: OPERATIONAL_STORY_IDS,
    })

    expect(unregistered).toEqual([])
    expect(violations).toEqual([])
    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })
})
