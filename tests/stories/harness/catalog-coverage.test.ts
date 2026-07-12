// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { loadCandidateStoryFiles } from '../../../scripts/story-manifest-candidate.js'
import { extractStoryScenarios } from '../../../scripts/story-manifest-scenarios.js'
import { CATALOG_SCENARIO_IDS, catalogCoverage, toPendingReason } from '../catalog/coverage.js'

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort()
}

describe('scenario catalog coverage', () => {
  test('classifies every catalog scenario exactly once', () => {
    const ledgerIds = catalogCoverage.map(({ scenarioId }) => scenarioId)

    expect(CATALOG_SCENARIO_IDS).toHaveLength(126)
    expect(new Set(CATALOG_SCENARIO_IDS).size).toBe(126)
    expect(sorted(ledgerIds)).toEqual(sorted(CATALOG_SCENARIO_IDS))
  })

  test('marks interaction scenarios as forward-only', () => {
    const interactionCoverage = catalogCoverage.filter(({ scenarioId }) => scenarioId.startsWith('SCN-interaction-'))

    expect(interactionCoverage).toHaveLength(4)
    expect(interactionCoverage.map(({ catalogStatus }) => catalogStatus)).toEqual([
      'forward-only',
      'forward-only',
      'forward-only',
      'forward-only',
    ])
  })

  test('rejects blank pending reasons at the ledger boundary', () => {
    expect(() => toPendingReason('   ')).toThrow('Pending reason must not be empty')
    expect(toPendingReason('  branch audit required  ').toString()).toBe('branch audit required')
  })

  test('keeps pending reasons and executable references accountable to local literal stories', async () => {
    const candidateFiles = await loadCandidateStoryFiles(process.cwd())
    const extractedStoryIds = new Set(
      candidateFiles.flatMap(({ path, bytes }) => extractStoryScenarios(path, bytes).map(({ id }) => id)),
    )
    const pendingCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'pending')
    const executableCoverage = catalogCoverage.filter((coverage) => coverage.kind === 'executable')

    for (const coverage of pendingCoverage) expect(coverage.reason.toString().trim().length).toBeGreaterThan(0)

    const executableReferences = executableCoverage.flatMap((coverage) => {
      expect(coverage.storyIds.length).toBeGreaterThanOrEqual(1)
      for (const storyId of coverage.storyIds) {
        expect(extractedStoryIds.has(storyId)).toBe(true)
      }
      return coverage.storyIds
    })

    expect(new Set(executableReferences).size).toBe(executableReferences.length)
  })
})
