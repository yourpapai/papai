// tests/platform/catalog-crosscheck.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { repoRoot } from '../smoke/harness/docker.js'
import { censusMarkedLane } from '../smoke/harness/lane-census.js'
import { catalogCoverage } from '../stories/catalog/coverage.js'
import { PLATFORM_COVERAGE_FILES, PLATFORM_STORIES, PLATFORM_STORY_IDS } from './scenarios/catalog.js'

describe('@3 catalog crosscheck', () => {
  test('every @3 catalog record maps one-to-one to a PLATFORM_STORIES id', () => {
    const executable = catalogCoverage.filter(
      (coverage): coverage is Extract<(typeof catalogCoverage)[number], { kind: 'executable' }> =>
        coverage.kind === 'executable',
    )
    const t3 = executable.filter((coverage) => coverage.provingTier === '3')

    expect(t3).toHaveLength(8)
    const platformStoryScenarioIds: string[] = Object.keys(PLATFORM_STORIES)
    for (const scenarioId of [
      'SCN-interaction-discord-command-routing',
      'SCN-interaction-discord-format-chunking',
      'SCN-interaction-discord-response-lifecycle',
      'SCN-interaction-kontur-reply-formatting',
      'SCN-interaction-telegram-admin-authorization',
    ]) {
      expect(platformStoryScenarioIds).toContain(scenarioId)
    }
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

  test('every @3 scenario marker is registered and claimed, and none bypasses title()', async () => {
    const { census, unregistered, violations } = await censusMarkedLane({
      tier: '3',
      glob: 'tests/platform/scenarios/*.platform.ts',
      registry: PLATFORM_STORY_IDS,
    })

    expect(unregistered).toEqual([])
    expect(violations).toEqual([])
    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })

  test('PLATFORM_COVERAGE_FILES declares every @3 adapter source the coverage gate enforces', () => {
    expect(PLATFORM_COVERAGE_FILES).toEqual([
      'src/chat/discord/commands.ts',
      'src/chat/discord/format-chunking.ts',
      'src/chat/discord/interaction-helpers.ts',
      'src/chat/kontur-talk/reply-helpers.ts',
      'src/chat/telegram/admin-helpers.ts',
    ])
  })
})
