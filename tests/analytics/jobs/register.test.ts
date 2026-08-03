// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ANALYTICS_JOB_NAMES, ANALYTICS_JOB_SPECS, CENSOR_MATURITY_CRON } from '../../../src/analytics/jobs/register.js'
import type { AnalyticsJobSpec } from '../../../src/analytics/jobs/register.js'

const isCronSpec = (spec: AnalyticsJobSpec): spec is Extract<AnalyticsJobSpec, { cron: string }> => 'cron' in spec

describe('analytics job specs module', () => {
  test('names and specs stay consistent and unique', () => {
    expect(new Set(ANALYTICS_JOB_NAMES).size).toBe(ANALYTICS_JOB_NAMES.length)
    expect(ANALYTICS_JOB_SPECS.map((spec) => spec.name)).toEqual([...ANALYTICS_JOB_NAMES])
  })

  test('the censor maturity job runs daily at 01:15 via cron', () => {
    const cronSpecs = ANALYTICS_JOB_SPECS.filter(isCronSpec)
    expect(cronSpecs).toHaveLength(1)
    expect(cronSpecs[0]?.name).toBe('analytics-censor-maturity')
    expect(cronSpecs[0]?.cron).toBe(CENSOR_MATURITY_CRON)
  })
})
