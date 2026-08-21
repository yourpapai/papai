// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import nodePath from 'node:path'

import { loadCandidateStoryFiles } from '../../../scripts/story/inputs.js'
import { extractStoryScenarios } from '../../../scripts/story/scenarios.js'
import { censusTier } from '../catalog/census.js'
import { PARITY_GROUPS } from './parity/expectations.js'

// A story scenario that no catalog record claims is a coverage claim nobody
// made. Two legal remedies when this fails:
//   1. add the story id to the record it proves, in EXECUTABLE_STORY_MAPPINGS
//      (a record may hold several story ids), minting a new SCN id if no
//      record describes the behavior; or
//   2. declare it in SUPPORTING_STORIES with a rationale, if it genuinely
//      proves no cataloged behavior.
// Do not silence this by deleting the scenario from the census input.

// This suite also runs from a read-only snapshot whose root sits three levels
// above the harness directory, so the story root is resolved rather than assumed.
// `tests/stories/harness/catalog-coverage.test.ts` resolves it the same way.
function resolveStoryContractRoot(harnessDirectory: string): string {
  return nodePath.resolve(harnessDirectory, '../../..')
}

describe('story catalog census', () => {
  test('every Tier 0 story scenario is claimed by a record or declared supporting', async () => {
    const files = await loadCandidateStoryFiles(resolveStoryContractRoot(import.meta.dir))
    const observed = files.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map(({ id }) => id))

    const census = censusTier('0', observed)

    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })

  test('every Tier 1 parity group is claimed by a record', () => {
    const observed = PARITY_GROUPS.map((group) => `tests/e2e/parity/provider-parity.test.ts#${group.title}`)

    const census = censusTier('1', observed)

    expect(census.orphans).toEqual([])
    expect(census.dangling).toEqual([])
  })
})
