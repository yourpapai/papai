// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminScenarios } from '../../../../client/stories/msw/scenarios-admin.js'

describe('msw admin scenarios', () => {
  test('admin-populated composes billing, stats, pluginConfig, instances, and identityMappings families', () => {
    expect(adminScenarios['admin-populated'].length).toBe(15)
  })

  test('settings-admin-users-populated resolves to a non-empty handler bundle', () => {
    expect(adminScenarios['settings-admin-users-populated'].length).toBeGreaterThan(0)
  })

  test('settings-shell-admin-ready resolves to a non-empty handler bundle', () => {
    expect(adminScenarios['settings-shell-admin-ready'].length).toBeGreaterThan(0)
  })

  test('settings-admin-analytics-populated resolves to a non-empty handler bundle', () => {
    expect(adminScenarios['settings-admin-analytics-populated'].length).toBeGreaterThan(0)
  })
})
