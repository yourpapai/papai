// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getTableName } from 'drizzle-orm'

import {
  analyticsCensorIntervals,
  analyticsFeatureOpportunityDays,
  analyticsFeatureUseDays,
  analyticsGoalAttempts,
  analyticsSessionEvents,
  analyticsSessions,
  analyticsTurnFriction,
} from '../../src/db/analytics-derive-schema.js'

describe('analytics derive drizzle schema', () => {
  test('maps every derived materialization table name', () => {
    const names = [
      analyticsSessions,
      analyticsSessionEvents,
      analyticsGoalAttempts,
      analyticsFeatureOpportunityDays,
      analyticsFeatureUseDays,
      analyticsTurnFriction,
      analyticsCensorIntervals,
    ].map((table) => getTableName(table))
    expect(names).toEqual([
      'analytics_sessions',
      'analytics_session_events',
      'analytics_goal_attempts',
      'analytics_feature_opportunity_days',
      'analytics_feature_use_days',
      'analytics_turn_friction',
      'analytics_censor_intervals',
    ])
  })
})
