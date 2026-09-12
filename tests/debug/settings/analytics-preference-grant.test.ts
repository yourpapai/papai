// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { getPreference } from '../../../src/analytics/governance/preference-store.js'
import * as schema from '../../../src/db/schema.js'
import { handleAnalyticsRoutes } from '../../../src/debug/settings/analytics-routes.js'
import type { AnalyticsActorRouteDeps } from '../../../src/debug/settings/analytics-routes.js'
import { addUser } from '../../../src/users.js'
import { govActorKeyFor, IDENTITY_A, makeSubjectDeps, refKeyFor } from '../../analytics/subject-fixtures.js'
import { mockLogger, seedTestPlatformInstance, setupTestDb } from '../../utils/test-helpers.js'
import { authHeaders, establishSession, type SettingsSession } from './helpers.js'

type Db = Awaited<ReturnType<typeof setupTestDb>>

const PREFERENCES = '/settings/api/analytics/preferences'
const ELIGIBILITY_TABLE = 'analytics_collection_eligibility'

/**
 * The settings handler's two consent lanes are `localLongitudinal` and
 * `externalPseudonymous`; those are what gate the runtime's
 * `local_pseudonymous` / `external_pseudonymous` lanes. Consent in this file
 * means either of them reading `allow` after the write.
 */
type PreferenceBody = Readonly<{ localLongitudinal?: 'allow' | 'deny'; externalPseudonymous?: 'allow' | 'deny' }>

/**
 * Takes the eligibility table out from under the grant, so the write inside the
 * preference transaction raises for real. Faithful to the failure the
 * requirement describes -- the grant write itself fails -- rather than to a
 * stubbed handler that never opened a transaction at all.
 */
const withEligibilityTableMissing = async (db: Db, act: () => Promise<unknown>): Promise<unknown> => {
  db.run(sql.raw(`ALTER TABLE ${ELIGIBILITY_TABLE} RENAME TO ${ELIGIBILITY_TABLE}_hidden`))
  try {
    return await act()
  } finally {
    db.run(sql.raw(`ALTER TABLE ${ELIGIBILITY_TABLE}_hidden RENAME TO ${ELIGIBILITY_TABLE}`))
  }
}

describe('settings preference write and the collection-eligibility ref', () => {
  let session: SettingsSession
  let deps: AnalyticsActorRouteDeps
  let db: Db

  const put = (body: PreferenceBody): Promise<Response> =>
    handleAnalyticsRoutes(
      new Request(`https://x${PREFERENCES}`, {
        method: 'PUT',
        headers: authHeaders(session, true),
        body: JSON.stringify(body),
      }),
      new URL(`https://x${PREFERENCES}`),
      deps,
    )

  const eligibilityRow = (): typeof schema.analyticsCollectionEligibility.$inferSelect | undefined =>
    db
      .select()
      .from(schema.analyticsCollectionEligibility)
      .all()
      .find((row) => row.refKey === refKeyFor(IDENTITY_A, 'v3'))

  const storedLanes = (): Readonly<{ localLongitudinal: string; externalPseudonymous: string }> => {
    const row = getPreference(govActorKeyFor(IDENTITY_A, 'v3'), { getDrizzleDb: (): Db => db })
    return {
      localLongitudinal: row?.localLongitudinal ?? 'unknown',
      externalPseudonymous: row?.externalPseudonymous ?? 'unknown',
    }
  }

  beforeEach(async () => {
    mockLogger()
    db = await setupTestDb()
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'user-a', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
    session = await establishSession(IDENTITY_A)
    deps = { subject: makeSubjectDeps(db) }
  })

  test('consenting to the local longitudinal lane grants the ref', async () => {
    expect((await put({ localLongitudinal: 'allow' })).status).toBe(200)

    expect(eligibilityRow()?.state).toBe('allow')
    expect(eligibilityRow()?.keyVersion).toBe('v3')
  })

  test('consenting to the external pseudonymous lane grants the ref', async () => {
    expect((await put({ externalPseudonymous: 'allow' })).status).toBe(200)

    expect(eligibilityRow()?.state).toBe('allow')
  })

  test('denying both lanes grants nothing at all', async () => {
    expect((await put({ localLongitudinal: 'deny', externalPseudonymous: 'deny' })).status).toBe(200)

    // Not "no allow row" but no row: a deny write for a subject who never
    // consented must not conjure an eligibility record to deny.
    expect(eligibilityRow()).toBeUndefined()
  })

  test('the ref is keyed to the subject and not to any other subject', async () => {
    await put({ localLongitudinal: 'allow' })

    const rows = db.select().from(schema.analyticsCollectionEligibility).all()
    expect(rows.map((row) => row.refKey)).toEqual([refKeyFor(IDENTITY_A, 'v3')])
  })

  test('leaving every pseudonymous lane clears the ref', async () => {
    await put({ localLongitudinal: 'allow', externalPseudonymous: 'allow' })
    expect(eligibilityRow()?.state).toBe('allow')

    await put({ localLongitudinal: 'deny', externalPseudonymous: 'deny' })

    expect(eligibilityRow()?.state).toBe('deny')
    expect(eligibilityRow()?.revokedAt).not.toBeNull()
  })

  test('the ref survives while one pseudonymous lane still reads allow', async () => {
    await put({ localLongitudinal: 'allow', externalPseudonymous: 'allow' })

    await put({ externalPseudonymous: 'deny' })

    expect(eligibilityRow()?.state).toBe('allow')
    expect(storedLanes()).toEqual({ localLongitudinal: 'allow', externalPseudonymous: 'deny' })
  })

  test('a failed grant rolls the preference write back and reports the failure', async () => {
    await put({ localLongitudinal: 'deny' })
    const before = storedLanes()

    await withEligibilityTableMissing(db, async () => {
      await expect(put({ localLongitudinal: 'allow' })).rejects.toThrow()
    })

    // Both halves: the consent did not survive its missing ref, and no ref was
    // left behind by a half-applied transaction.
    expect(storedLanes()).toEqual(before)
    expect(eligibilityRow()).toBeUndefined()
  })
})
