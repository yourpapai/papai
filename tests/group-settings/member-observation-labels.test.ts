// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { getGroupUserObservationLabels, upsertGroupUserObservation } from '../../src/group-settings/registry.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('getGroupUserObservationLabels', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns displayLabel per userId for matching (provider, contextId)', () => {
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'c1',
      userId: '42',
      username: 'ann',
      displayLabel: 'Ann (@ann)',
    })
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'c1',
      userId: '43',
      username: null,
      displayLabel: 'Bob',
    })
    upsertGroupUserObservation({
      provider: 'telegram',
      contextId: 'other',
      userId: '42',
      username: 'x',
      displayLabel: 'Wrong Ctx',
    })

    const labels = getGroupUserObservationLabels('telegram', 'c1', ['42', '43', '99'])
    expect(labels.get('42')).toBe('Ann (@ann)')
    expect(labels.get('43')).toBe('Bob')
    expect(labels.has('99')).toBe(false)
  })

  test('returns an empty map for no ids', () => {
    expect(getGroupUserObservationLabels('telegram', 'c1', []).size).toBe(0)
  })
})
