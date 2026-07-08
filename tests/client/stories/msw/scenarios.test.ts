// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { scenarios, type ScenarioName } from '../../../../client/stories/msw/scenarios.js'

describe('msw scenarios', () => {
  test.each<ScenarioName>([
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
    'settings-repos-populated',
    'settings-byok-secret-set',
    'settings-kaneo-populated',
    'settings-admin-users-populated',
    'settings-admin-mcp-catalog-populated',
    'settings-admin-mcp-catalog-empty',
    'settings-shell-ready',
  ])('%s resolves to a non-empty handler bundle', (name) => {
    expect(scenarios[name].length).toBeGreaterThan(0)
  })

  test('admin-populated composes billing, stats, pluginConfig, instances, and identityMappings families', () => {
    // billing (2) + stats (2) + pluginConfig (2) + instances (8) + identityMappings (1) populated handlers
    // admin handlers are now empty (System / LLM section removed)
    expect(scenarios['admin-populated'].length).toBe(15)
  })
})
