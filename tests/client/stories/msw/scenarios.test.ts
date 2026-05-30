// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { scenarios, type ScenarioName } from '../../../../client/stories/msw/scenarios.js'

describe('msw scenarios', () => {
  test.each<ScenarioName>([
    'admin-populated',
    'admin-empty',
    'admin-error',
    'billing-populated',
    'billing-empty',
    'billing-error',
    'billing-loading',
    'stats-populated',
    'plugin-config-populated',
    'plugin-config-empty',
    'plugin-config-error',
    'instances-populated',
    'instances-empty',
    'instances-error',
  ])('%s resolves to a non-empty handler bundle', (name) => {
    expect(scenarios[name].length).toBeGreaterThan(0)
  })

  test('admin-populated composes admin, billing, stats, pluginConfig, and instances families', () => {
    // admin (2) + billing (2) + stats (2) + pluginConfig (2) + instances (8) populated handlers
    expect(scenarios['admin-populated'].length).toBe(16)
  })
})
