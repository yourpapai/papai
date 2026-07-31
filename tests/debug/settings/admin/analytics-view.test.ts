// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildAdminView, openPanelBlockReasons } from '../../../../src/debug/settings/admin/analytics-view.js'
import type { AdminAnalyticsRouteDeps } from '../../../../src/debug/settings/admin/analytics-view.js'
import { KEYRING } from '../../../analytics/subject-fixtures.js'
import { mockLogger, setupTestDb } from '../../../utils/test-helpers.js'

describe('admin analytics view', () => {
  let deps: AdminAnalyticsRouteDeps

  beforeEach(async () => {
    mockLogger()
    const db = await setupTestDb()
    deps = {
      getDrizzleDb: (): typeof db => db,
      analyticsKeyring: KEYRING.analytics,
      governanceKeyring: KEYRING.governance,
      probe: (): Promise<Readonly<{ ok: boolean }>> => Promise.resolve({ ok: true }),
    }
  })

  test('openPanelBlockReasons lists the failed strict capability gates', () => {
    const reasons = openPanelBlockReasons()
    expect(reasons).toContain('missing_caller_controlled_idempotency')
    expect(reasons).toContain('missing_delete_actor')
    expect(reasons).not.toContain('missing_deterministic_reconciliation')
  })

  test('buildAdminView exposes the read-only horizon and never leaks sink ciphertext', () => {
    const view = buildAdminView(deps, 1_800_000_000_000)
    expect(view.policy.subjectRightsLookupHorizonDays).toBe(90)
    expect(view.readiness.ready).toBe(false)
    expect(view.sinks).toEqual([])
    expect(view.snapshot).toBeNull()
    expect(JSON.stringify(view)).not.toContain('Ciphertext')
  })
})
