// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createAnalyticsJobHandlers } from '../../../src/analytics/jobs/register-handlers.js'
import { ANALYTICS_JOB_NAMES } from '../../../src/analytics/jobs/register.js'
import type { AnalyticsJobDeps } from '../../../src/analytics/jobs/register.js'

describe('analytics job handler factory', () => {
  test('builds exactly one handler per registered job name', () => {
    const deps: AnalyticsJobDeps = {
      nowMs: () => 0,
      getDrizzleDb: () => {
        throw new Error('db must not be touched while building handlers')
      },
      lanes: () => ({
        killSwitchActive: true,
        localMode: 'off',
        externalAggregateEnabled: false,
        externalPseudonymousEnabled: false,
      }),
      observer: () => null,
      openEpochId: () => null,
      keyMaterial: () => null,
      snapshotPath: () => null,
    }
    const handlers = createAnalyticsJobHandlers(deps)
    expect(Object.keys(handlers).sort()).toEqual([...ANALYTICS_JOB_NAMES].sort())
  })
})
