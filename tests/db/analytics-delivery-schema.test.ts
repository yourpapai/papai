// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { getTableName } from 'drizzle-orm'

import {
  analyticsAggregateDeliveries,
  analyticsAggregateReleases,
  analyticsDeliveries,
  analyticsDeliveryDeletionReceipts,
  analyticsSinks,
} from '../../src/db/analytics-delivery-schema.js'

describe('analytics delivery drizzle schema', () => {
  test('maps every delivery-ledger table name', () => {
    const names = [
      analyticsSinks,
      analyticsDeliveries,
      analyticsAggregateReleases,
      analyticsAggregateDeliveries,
      analyticsDeliveryDeletionReceipts,
    ].map((table) => getTableName(table))
    expect(names).toEqual([
      'analytics_sinks',
      'analytics_deliveries',
      'analytics_aggregate_releases',
      'analytics_aggregate_deliveries',
      'analytics_delivery_deletion_receipts',
    ])
  })
})
