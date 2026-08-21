// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { DOCUMENTED_BEHAVIOR_IDS } from '../catalog/behavior-inventory.js'
import {
  BEHAVIOR_COVERAGE,
  coverageGaps,
  requiredDimensions,
  scenarioReferenceGaps,
  unqualifiedBehaviors,
  type BehaviorCoverage,
} from '../catalog/behaviors.js'

test('documented behavior IDs are unique and source anchors occur exactly once', async () => {
  expect(new Set(DOCUMENTED_BEHAVIOR_IDS).size).toBe(DOCUMENTED_BEHAVIOR_IDS.length)
  const document = await Bun.file(`${import.meta.dir}/../../../docs/architecture/behaviors.md`).text()
  for (const id of DOCUMENTED_BEHAVIOR_IDS) {
    expect(document.split(`<!-- behavior:${id} -->`).length - 1).toBe(1)
  }
})

test('every documented behavior has one ledger record', () => {
  expect(BEHAVIOR_COVERAGE.map(({ behaviorId }) => behaviorId).toSorted()).toEqual(
    [...DOCUMENTED_BEHAVIOR_IDS].toSorted(),
  )
})

test('implemented behavior records name a proving tier and an executable catalog scenario', () => {
  expect(coverageGaps(BEHAVIOR_COVERAGE)).toEqual([])
})

test('every ledger scenario reference resolves to an executable catalog record at the declared tier', () => {
  expect(scenarioReferenceGaps(BEHAVIOR_COVERAGE)).toEqual([])
})

test('partial implemented behaviors are reported as ineligible for global qualification', () => {
  expect(unqualifiedBehaviors(BEHAVIOR_COVERAGE)).toContain('live-status')
  expect(unqualifiedBehaviors(BEHAVIOR_COVERAGE)).toEqual([
    'alert-edge-triggering',
    'chat-participant-resolution',
    'identity-provisioning',
    'live-status',
    'mid-run-control',
    'privacy-gated-analytics',
    'release-announcements',
    'reply-to-bot-routing',
  ])
})

const splitTierRecord: BehaviorCoverage = {
  behaviorId: 'live-status',
  state: 'partial',
  proven: {
    primary: { provingTier: '2', scenarioIds: ['SCN-chat-turn-tool-loop'] },
    'failure-recovery': { provingTier: '0', scenarioIds: ['SCN-task-guest-readonly'] },
  },
  missing: { 'authorization-routing': '3' },
  rationale: 'The process-real turn proves the status lifecycle; the hermetic story proves error cleanup.',
}

describe('per-dimension tier claims', () => {
  test('rejects a dimension citing a scenario the catalog proves at another tier', () => {
    expect(
      scenarioReferenceGaps([
        {
          ...splitTierRecord,
          proven: { primary: { provingTier: '0', scenarioIds: ['SCN-chat-turn-tool-loop'] } },
        },
      ]),
    ).toEqual(['live-status: primary cites SCN-chat-turn-tool-loop, which proves at tier 2, not declared tier 0'])
  })

  test('rejects a dimension citing a scenario the catalog does not execute', () => {
    expect(
      scenarioReferenceGaps([
        {
          ...splitTierRecord,
          // SCN-cmd-announce is a catalogued gap: a real scenario id with no executable record.
          proven: { primary: { provingTier: '0', scenarioIds: ['SCN-cmd-announce'] } },
        },
      ]),
    ).toEqual(['live-status: primary cites SCN-cmd-announce, which is not an executable catalog scenario'])
  })

  test('accepts one behavior proving two dimensions at two different tiers', () => {
    expect(scenarioReferenceGaps([splitTierRecord])).toEqual([])
    expect(coverageGaps([splitTierRecord])).toEqual([])
  })

  test('derives the required dimension set as the union of proven and open dimensions', () => {
    expect(requiredDimensions(splitTierRecord)).toEqual(['primary', 'authorization-routing', 'failure-recovery'])
  })
})

describe('planned tiers on open dimensions', () => {
  test('a planned tier is not evidence: the behavior stays unqualified', () => {
    expect(unqualifiedBehaviors([splitTierRecord])).toEqual(['live-status'])
  })

  test('a planned tier is never validated as a scenario reference', () => {
    expect(scenarioReferenceGaps([{ ...splitTierRecord, missing: { 'authorization-routing': '4' } }])).toEqual([])
  })
})

describe('coverageGaps', () => {
  const implementedRecord: BehaviorCoverage = {
    behaviorId: 'guest-readonly',
    state: 'implemented',
    proven: {
      primary: { provingTier: '0', scenarioIds: ['SCN-task-guest-readonly'] },
      'authorization-routing': { provingTier: '0', scenarioIds: ['SCN-settings-api-group'] },
    },
    missing: {},
    rationale: 'Guest read-only toolset is proven by the guest group-turn story.',
  }

  test('flags blank rationales, a missing primary dimension, and missing scenarios deterministically', () => {
    expect(
      coverageGaps([
        { ...implementedRecord, rationale: '   ' },
        {
          ...implementedRecord,
          proven: { 'authorization-routing': { provingTier: '0', scenarioIds: ['SCN-settings-api-group'] } },
        },
        { ...implementedRecord, proven: {} },
        implementedRecord,
      ]),
    ).toEqual([
      'guest-readonly: blank rationale',
      'guest-readonly: missing primary dimension',
      'guest-readonly: missing scenario',
    ])
  })

  test('flags a proven dimension that cites no scenario', () => {
    expect(
      coverageGaps([{ ...implementedRecord, proven: { primary: { provingTier: '0', scenarioIds: [] } } }]),
    ).toEqual(['guest-readonly: primary proven with no scenario'])
  })

  test('flags a partial record that leaves no dimension open', () => {
    expect(coverageGaps([{ ...splitTierRecord, missing: {} }])).toEqual([
      'live-status: partial record with no open dimension',
    ])
  })

  test('accepts a partial record that proves nothing yet but declares planned tiers', () => {
    expect(
      coverageGaps([
        {
          behaviorId: 'reply-to-bot-routing',
          state: 'partial',
          proven: {},
          missing: { primary: '0', 'authorization-routing': '3' },
          rationale: 'No story sends a group reply to the bot’s own message yet.',
        },
      ]),
    ).toEqual([])
  })

  test('does not demand scenarios or a primary dimension from blocked or retired records', () => {
    const blockedRecord: BehaviorCoverage = {
      behaviorId: 'mid-run-control',
      state: 'blocked:missing-implementation',
      proven: {},
      missing: {},
      rationale: 'No production implementation exists yet.',
    }
    expect(coverageGaps([blockedRecord, { ...blockedRecord, rationale: '' }])).toEqual([
      'mid-run-control: blank rationale',
    ])
  })
})
