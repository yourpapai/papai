// tests/smoke/scenarios/catalog.test.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { SMOKE_STORIES, SMOKE_STORY_IDS, smokeStoryId, type SmokeStory } from './catalog.js'

describe('SMOKE_STORIES registry', () => {
  test('registers exactly eight @2 stories with well-formed, unique ids', () => {
    const entries = Object.entries(SMOKE_STORIES) as Array<[string, SmokeStory]>
    expect(entries).toHaveLength(8)
    for (const [key, story] of entries) {
      expect(story.scenarioId).toBe(key)
      expect(story.file.startsWith('tests/smoke/')).toBe(true)
      expect(smokeStoryId(story)).toBe(`${story.file}#${story.title}`)
    }
    const ids = Object.values(SMOKE_STORY_IDS)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('maps each scenario to its owning container file', () => {
    expect(SMOKE_STORIES['SCN-boot-serve-empty-db'].file).toBe('tests/smoke/scenarios/container-p.smoke.ts')
    expect(SMOKE_STORIES['SCN-debug-surface-gated-on'].file).toBe('tests/smoke/scenarios/container-d.smoke.ts')
    expect(SMOKE_STORIES['SCN-required-env-admin'].file).toBe('tests/smoke/scenarios/container-e.smoke.ts')
  })
})
