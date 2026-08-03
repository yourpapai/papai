// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { verifyMappingNormalizedContentIn } from '../../../src/analytics/rekey/verify-content.js'
import { verifyShadowEquationIn } from '../../../src/analytics/rekey/verify.js'
import { setupTestDb } from '../../utils/test-helpers.js'
import { GOV_KEY_V2, seedRekeySourceGraph } from './fixtures.js'
import { MATERIAL, mustRun, planRun, runFullCopy } from './verify.test.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

describe('rekey mapping-normalized content verification', () => {
  let db: Db

  beforeEach(async () => {
    db = await setupTestDb()
    seedRekeySourceGraph(db)
    planRun(db)
  })

  test('mapping-normalized parent and child content matches after copy', () => {
    runFullCopy(db)
    const report = db.transaction((tx) => verifyMappingNormalizedContentIn(tx, mustRun(db), MATERIAL))
    expect(report.ok).toBe(true)
    expect(report.mismatches).toEqual([])
  })

  test('tampered shadow content fails the mapping-normalized comparison', () => {
    runFullCopy(db)
    db.$client.run(
      `UPDATE analytics_events SET actor_key = 'v2.p-tampered' WHERE storage_generation = 'gen-2' AND event_name = 'llm_completed'`,
    )
    const equation = db.transaction((tx) => verifyShadowEquationIn(tx, mustRun(db), [GOV_KEY_V2]))
    expect(equation.ok).toBe(true)
    const content = db.transaction((tx) => verifyMappingNormalizedContentIn(tx, mustRun(db), MATERIAL))
    expect(content.ok).toBe(false)
    expect(content.mismatches.length).toBeGreaterThan(0)
  })
})
