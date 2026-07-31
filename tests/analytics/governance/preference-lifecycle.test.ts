// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  appendPolicyAuditInTx,
  purgeSupersededAuditIn,
  upsertPreferenceDenyInTx,
} from '../../../src/analytics/governance/preference-lifecycle.js'
import * as schema from '../../../src/db/schema.js'
import { setupTestDb } from '../../utils/test-helpers.js'

const T = 1_800_000_000_000

describe('preference lifecycle tx helpers', () => {
  let db: Awaited<ReturnType<typeof setupTestDb>>

  beforeEach(async () => {
    db = await setupTestDb()
  })

  test('upsertPreferenceDenyInTx denies both lanes for every targeted key', () => {
    db.transaction((tx) => {
      upsertPreferenceDenyInTx(tx, {
        governanceActorKey: 'v1.g-a',
        keyVersion: 'v1',
        policyVersion: 3,
        source: 'authenticated_request',
        nowMs: T,
      })
    })
    const row = db.select().from(schema.analyticsPreferences).all()
    expect(row).toHaveLength(1)
    expect(row[0]?.localLongitudinal).toBe('deny')
    expect(row[0]?.externalPseudonymous).toBe('deny')
  })

  test('appendPolicyAuditInTx writes an audit row and returns its id', () => {
    const auditId = db.transaction((tx) =>
      appendPolicyAuditInTx(tx, {
        governanceActorKey: 'v1.g-a',
        action: 'delete_requested',
        policyVersion: 3,
        nowMs: T,
      }),
    )
    const rows = db.select().from(schema.analyticsPolicyAudit).all()
    expect(rows.map((row) => row.auditId)).toEqual([auditId])
    expect(rows[0]?.action).toBe('delete_requested')
  })

  test('purgeSupersededAuditIn removes expired superseded rows but keeps the newest per actor', () => {
    const insert = (auditId: string, actor: string, occurredAt: number): void => {
      db.insert(schema.analyticsPolicyAudit)
        .values({
          auditId,
          governanceActorKey: actor,
          action: 'allow',
          policyVersion: 1,
          occurredAt,
          result: 'applied',
          failureClass: null,
        })
        .run()
    }
    insert('a1', 'v1.g-a', T - 10)
    insert('a2', 'v1.g-a', T)
    insert('b1', 'v1.g-b', T - 10)

    const removed = db.transaction((tx) => purgeSupersededAuditIn(tx, { nowMs: T, deadlineFor: () => T - 5 }))
    expect(removed).toBe(1)
    expect(
      db
        .select()
        .from(schema.analyticsPolicyAudit)
        .all()
        .map((row) => row.auditId)
        .sort(),
    ).toEqual(['a2', 'b1'])
  })
})
