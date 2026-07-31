// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  insertEligibleCanonicalEvent,
  MissingCollectionRefError,
} from '../../../src/analytics/governance/collection-serialization.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { createTestEpoch, makeTestEvent, TEST_EPOCH_ID } from '../storage-fixtures.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const storedRowCounts = (db: Db): Readonly<{ events: number; epochCounters: number }> => ({
  events: db.select({ eventId: schema.analyticsEvents.eventId }).from(schema.analyticsEvents).all().length,
  epochCounters: db
    .select({ epochId: schema.analyticsEpochSourceCounters.epochId })
    .from(schema.analyticsEpochSourceCounters)
    .all().length,
})

describe('collection-serialization insertion API guard', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    createTestEpoch(db)
  })

  test('omitting the collection ref is a compile-time error and fails closed at runtime', () => {
    const input = { event: makeTestEvent(), processEpochId: TEST_EPOCH_ID }
    let caught: unknown
    try {
      // @ts-expect-error - collectionRef is required for fail-closed canonical insertion
      insertEligibleCanonicalEvent(input, { getDrizzleDb: () => db })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MissingCollectionRefError)
    expect(storedRowCounts(db)).toEqual({ events: 0, epochCounters: 0 })
  })

  test('a null collection ref is a compile-time error and fails closed at runtime', () => {
    const input = {
      event: makeTestEvent(),
      processEpochId: TEST_EPOCH_ID,
      collectionRef: null,
    }
    let caught: unknown
    try {
      // @ts-expect-error - null is not a valid collection ref
      insertEligibleCanonicalEvent(input, { getDrizzleDb: () => db })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(MissingCollectionRefError)
    expect(storedRowCounts(db)).toEqual({ events: 0, epochCounters: 0 })
  })
})
