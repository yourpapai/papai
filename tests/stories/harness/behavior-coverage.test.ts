// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { DOCUMENTED_BEHAVIOR_IDS } from '../catalog/behavior-inventory.js'
import {
  BEHAVIOR_COVERAGE,
  coverageGaps,
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

describe('coverageGaps', () => {
  const implementedRecord: BehaviorCoverage = {
    behaviorId: 'guest-readonly',
    state: 'implemented',
    provingTier: '0',
    scenarioIds: ['SCN-task-guest-readonly'],
    required: ['primary', 'authorization-routing'],
    missing: [],
    rationale: 'Guest read-only toolset is proven by the guest group-turn story.',
  }

  test('flags blank rationales, a missing primary dimension, and missing scenarios deterministically', () => {
    expect(
      coverageGaps([
        { ...implementedRecord, rationale: '   ' },
        { ...implementedRecord, required: ['authorization-routing'] },
        { ...implementedRecord, scenarioIds: [] },
        implementedRecord,
      ]),
    ).toEqual([
      'guest-readonly: blank rationale',
      'guest-readonly: missing primary dimension',
      'guest-readonly: missing scenario',
    ])
  })

  test('does not demand scenarios or a primary dimension from blocked or retired records', () => {
    const blockedRecord: BehaviorCoverage = {
      behaviorId: 'mid-run-control',
      state: 'blocked:missing-implementation',
      provingTier: null,
      scenarioIds: [],
      required: [],
      missing: [],
      rationale: 'No production implementation exists yet.',
    }
    expect(coverageGaps([blockedRecord, { ...blockedRecord, rationale: '' }])).toEqual([
      'mid-run-control: blank rationale',
    ])
  })
})
