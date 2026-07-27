// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  aggregateReleaseCellKey,
  applyReleaseSuppression,
  assessReleaseRequest,
  EXTERNAL_ACTOR_THRESHOLD,
  EXTERNAL_GUEST_CONTEXT_THRESHOLD,
  EXTERNAL_GUEST_TURN_THRESHOLD,
  isPrimarySuppressed,
  latticeDimensionOf,
} from '../../../src/analytics/delivery/release-suppression.js'
import type {
  CellDimensions,
  ReleaseCellInput,
  ReleaseRequest,
} from '../../../src/analytics/delivery/release-suppression.js'

const DAY = '2026-07-20'
const NOW = Date.UTC(2026, 6, 21, 1, 0, 0)

const dims = (
  platform = 'all',
  contextType = 'all',
  actorRole = 'all',
  taskProvider = 'all',
  appVersion = 'all',
): CellDimensions => ({ platform, contextType, actorRole, taskProvider, appVersion })

const cell = (overrides: Partial<ReleaseCellInput> = {}): ReleaseCellInput => ({
  utcDay: DAY,
  metric: 'turn_started',
  measureKind: 'counter',
  dimensions: dims(),
  counterValue: 25,
  finalized: true,
  partialDay: false,
  reconciliationStatus: 'complete_epoch',
  contributorBasis: 'eligible_actor',
  contributorCount: 12,
  ...overrides,
})

// Indexed-access helper at module scope — no-conditional-in-test forbids ?? in test bodies.
const at = (cells: readonly ReleaseCellInput[], index: number): ReleaseCellInput => {
  const found = cells[index]
  if (found === undefined) throw new Error(`missing cell at index ${index}`)
  return found
}

describe('frozen release lattice', () => {
  test('all-dimensions total is on the lattice', () => {
    expect(latticeDimensionOf(dims())).toBe('total')
  })

  test('exactly one varying dimension is a one-way child', () => {
    expect(latticeDimensionOf(dims('telegram'))).toBe('platform')
    expect(latticeDimensionOf(dims('all', 'dm'))).toBe('contextType')
    expect(latticeDimensionOf(dims('all', 'all', 'admin'))).toBe('actorRole')
    expect(latticeDimensionOf(dims('all', 'all', 'all', 'kaneo'))).toBe('taskProvider')
  })

  test('multi-dimension, app-version, and drill-through cells are off the lattice', () => {
    expect(latticeDimensionOf(dims('telegram', 'dm'))).toBeNull()
    expect(latticeDimensionOf(dims('telegram', 'all', 'admin'))).toBeNull()
    expect(latticeDimensionOf(dims('all', 'all', 'all', 'all', '6.10.0'))).toBeNull()
    expect(latticeDimensionOf(dims('telegram', 'all', 'all', 'all', '6.10.0'))).toBeNull()
  })

  const baseRequest: ReleaseRequest = { utcDay: DAY, nowMs: NOW }

  test('accepts a total or one-way complete-day request', () => {
    expect(assessReleaseRequest(baseRequest)).toEqual({ ok: true })
    expect(assessReleaseRequest({ ...baseRequest, dimensions: ['platform'] })).toEqual({ ok: true })
    expect(assessReleaseRequest({ ...baseRequest, appVersion: 'all' })).toEqual({ ok: true })
  })

  test('rejects multi-dimension, custom-range, rolling-window, app-version, drill-through, and incomplete days', () => {
    expect(assessReleaseRequest({ ...baseRequest, dimensions: ['platform', 'actorRole'] })).toEqual({
      ok: false,
      reason: 'multi_dimension',
    })
    expect(assessReleaseRequest({ ...baseRequest, endUtcDay: '2026-07-21' })).toEqual({
      ok: false,
      reason: 'custom_range',
    })
    expect(assessReleaseRequest({ ...baseRequest, rollingWindowDays: 7 })).toEqual({
      ok: false,
      reason: 'rolling_window',
    })
    expect(assessReleaseRequest({ ...baseRequest, appVersion: '6.10.0' })).toEqual({
      ok: false,
      reason: 'app_version',
    })
    expect(assessReleaseRequest({ ...baseRequest, drillThrough: true })).toEqual({
      ok: false,
      reason: 'drill_through',
    })
    expect(assessReleaseRequest({ utcDay: '2026-07-21', nowMs: NOW })).toEqual({
      ok: false,
      reason: 'incomplete_day',
    })
  })
})

describe('primary suppression thresholds', () => {
  test('actor-sensitive cells require at least 10 eligible actors', () => {
    expect(isPrimarySuppressed(cell({ contributorCount: EXTERNAL_ACTOR_THRESHOLD - 1 }))).toBe(true)
    expect(isPrimarySuppressed(cell({ contributorCount: EXTERNAL_ACTOR_THRESHOLD }))).toBe(false)
    expect(EXTERNAL_ACTOR_THRESHOLD).toBe(10)
  })

  test('guest cells require at least 10 turns and 10 contexts', () => {
    const guest = (turns: number, contexts: number): ReleaseCellInput =>
      cell({ metric: 'guest_turn', contributorBasis: 'context', counterValue: turns, contributorCount: contexts })
    expect(isPrimarySuppressed(guest(EXTERNAL_GUEST_TURN_THRESHOLD - 1, 15))).toBe(true)
    expect(isPrimarySuppressed(guest(15, EXTERNAL_GUEST_CONTEXT_THRESHOLD - 1))).toBe(true)
    expect(isPrimarySuppressed(guest(EXTERNAL_GUEST_TURN_THRESHOLD, EXTERNAL_GUEST_CONTEXT_THRESHOLD))).toBe(false)
    expect(EXTERNAL_GUEST_TURN_THRESHOLD).toBe(10)
    expect(EXTERNAL_GUEST_CONTEXT_THRESHOLD).toBe(10)
  })

  test('an unavailable contributor count is suppressed', () => {
    expect(isPrimarySuppressed(cell({ contributorCount: null }))).toBe(true)
    expect(
      isPrimarySuppressed(cell({ metric: 'guest_turn', contributorBasis: 'context', contributorCount: null })),
    ).toBe(true)
  })

  test('unreconciled restart-gap cells are never publishable', () => {
    expect(isPrimarySuppressed(cell({ reconciliationStatus: 'unreconciled_restart_gap' }))).toBe(true)
  })

  test('unfinalized or partial-day cells are suppressed', () => {
    expect(isPrimarySuppressed(cell({ finalized: false }))).toBe(true)
    expect(isPrimarySuppressed(cell({ partialDay: true }))).toBe(true)
  })

  test('an unknown contributor basis fails closed', () => {
    expect(isPrimarySuppressed(cell({ contributorBasis: 'mystery' }))).toBe(true)
  })
})

describe('complementary suppression', () => {
  const platformChild = (platform: string, value: number, contributors: number): ReleaseCellInput =>
    cell({ dimensions: dims(platform), counterValue: value, contributorCount: contributors })

  test('exactly one primary-suppressed child also suppresses the smallest releasable sibling', () => {
    const cells = [
      cell({ counterValue: 200, contributorCount: 80 }),
      platformChild('telegram', 5, 5),
      platformChild('mattermost', 30, 20),
      platformChild('discord', 40, 25),
      platformChild('kontur-talk', 50, 30),
    ]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 1)))).toBe('suppressed')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 2)))).toBe('suppressed')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 3)))).toBe('external_eligible')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 4)))).toBe('external_eligible')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 0)))).toBe('external_eligible')
  })

  test('smallest-sibling ties break by catalog order', () => {
    const cells = [
      cell({ counterValue: 200, contributorCount: 80 }),
      platformChild('telegram', 5, 5),
      platformChild('mattermost', 30, 20),
      platformChild('discord', 30, 25),
    ]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 2)))).toBe('suppressed')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 3)))).toBe('external_eligible')
  })

  test('two or more primary-suppressed children need no complementary suppression', () => {
    const cells = [
      cell({ counterValue: 200, contributorCount: 80 }),
      platformChild('telegram', 5, 5),
      platformChild('mattermost', 6, 6),
      platformChild('discord', 100, 60),
    ]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 3)))).toBe('external_eligible')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 0)))).toBe('external_eligible')
  })

  test('a single suppressed child with no releasable sibling suppresses the revealing parent total', () => {
    const cells = [cell({ counterValue: 5, contributorCount: 80 }), platformChild('telegram', 5, 5)]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 1)))).toBe('suppressed')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 0)))).toBe('suppressed')
  })

  test('a primary-suppressed parent stays suppressed while releasable children remain releasable', () => {
    const cells = [
      cell({ counterValue: 200, contributorCount: 5 }),
      platformChild('telegram', 100, 40),
      platformChild('mattermost', 100, 40),
    ]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 0)))).toBe('suppressed')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 1)))).toBe('external_eligible')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 2)))).toBe('external_eligible')
  })

  test('partitions are independent: suppression in one dimension does not touch another', () => {
    const cells = [
      cell({ counterValue: 500, contributorCount: 200 }),
      platformChild('telegram', 5, 5),
      platformChild('mattermost', 30, 20),
      platformChild('discord', 40, 25),
      cell({ dimensions: dims('all', 'dm'), counterValue: 300, contributorCount: 150 }),
      cell({ dimensions: dims('all', 'group'), counterValue: 200, contributorCount: 120 }),
    ]
    const decisions = applyReleaseSuppression(cells)
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 4)))).toBe('external_eligible')
    expect(decisions.get(aggregateReleaseCellKey(at(cells, 5)))).toBe('external_eligible')
  })
})
