// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  aggregateDeadlineMs,
  canonicalEventExpiryMs,
  DAY_MS,
  deliveryReceiptDeadlineMs,
  governanceAuditDeadlineMs,
  isUnexpired,
  pendingDeliveryDeadlineMs,
  resolveRetentionLimits,
  RetentionLimitExceededError,
  RETENTION_MAXIMA,
  utcDayStartMs,
} from '../../../src/analytics/retention/expiry-guard.js'

describe('expiry guard', () => {
  test('isUnexpired hides the row at the exact deadline', () => {
    expect(isUnexpired(99, 100)).toBe(true)
    expect(isUnexpired(100, 100)).toBe(false)
    expect(isUnexpired(101, 100)).toBe(false)
  })

  test('fixed maxima match the retention table', () => {
    expect(RETENTION_MAXIMA).toEqual({
      canonicalEventDays: 90,
      pendingDeliveryDays: 14,
      deliveryReceiptDays: 30,
      externalPseudonymousSinkDays: 90,
      assessedRollupDays: 400,
      supersededGovernanceAuditDays: 400,
      rephraseFeatureSetMinutes: 30,
    })
  })

  test('limits resolve to maxima by default and accept downward overrides only', () => {
    expect(resolveRetentionLimits().pendingDeliveryDays).toBe(14)
    expect(resolveRetentionLimits({ canonicalEventDays: 45 }).canonicalEventDays).toBe(45)
    expect(() => resolveRetentionLimits({ canonicalEventDays: 91 })).toThrow(RetentionLimitExceededError)
    expect(() => resolveRetentionLimits({ assessedRollupDays: 401 })).toThrow(RetentionLimitExceededError)
    expect(() => resolveRetentionLimits({ deliveryReceiptDays: 0 })).toThrow(RetentionLimitExceededError)
  })

  test('deadline computations follow the owning row class', () => {
    expect(canonicalEventExpiryMs(1000)).toBe(1000 + 90 * DAY_MS)
    expect(pendingDeliveryDeadlineMs({ occurredAtMs: 1000, expiresAtMs: 1000 + 90 * DAY_MS })).toBe(1000 + 14 * DAY_MS)
    expect(pendingDeliveryDeadlineMs({ occurredAtMs: 1000, expiresAtMs: 1000 + 10 * DAY_MS })).toBe(1000 + 10 * DAY_MS)
    expect(deliveryReceiptDeadlineMs(1000)).toBe(1000 + 30 * DAY_MS)
    expect(governanceAuditDeadlineMs(1000)).toBe(1000 + 400 * DAY_MS)
  })

  test('aggregate deadline distinguishes local and assessed rollups', () => {
    const day = '2027-01-01'
    const start = utcDayStartMs(day)
    expect(aggregateDeadlineMs(day, false)).toBe(start + DAY_MS + 90 * DAY_MS)
    expect(aggregateDeadlineMs(day, true)).toBe(start + DAY_MS + 400 * DAY_MS)
    expect(() => utcDayStartMs('not-a-day')).toThrow()
  })
})
