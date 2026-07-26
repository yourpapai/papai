// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  classifySendError,
  recoverOrphanedSends,
  reconcileAmbiguous,
} from '../../../src/analytics/delivery/store-outcomes.js'
import type { DeliveryStoreDeps } from '../../../src/analytics/delivery/store.js'
import { setupTestDb } from '../../utils/test-helpers.js'

describe('analytics delivery store outcomes', () => {
  let deps: DeliveryStoreDeps

  beforeEach(async () => {
    const db = await setupTestDb()
    deps = { getDrizzleDb: (): typeof db => db }
  })

  test('recovery on an empty ledger moves nothing', () => {
    expect(recoverOrphanedSends({ nowMs: 1000 }, deps)).toEqual({ moved: 0 })
  })

  test('reconcile on a missing row reports not_ambiguous', () => {
    expect(reconcileAmbiguous({ eventId: 'nope', sinkVersionId: 'sv-nope', outcome: 'dead', nowMs: 1000 }, deps)).toBe(
      'not_ambiguous',
    )
  })

  test('non-object errors classify as unknown', () => {
    expect(classifySendError(undefined)).toBe('unknown')
    expect(classifySendError(null)).toBe('unknown')
    expect(classifySendError(42)).toBe('unknown')
  })
})
