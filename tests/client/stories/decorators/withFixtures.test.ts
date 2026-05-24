// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { adminState } from '../../../../client/admin/admin.svelte.js'
import { adminGlobals } from '../../../../client/admin/global-stats.svelte.js'
import { resetAllSingletons, resolveScenario } from '../../../../client/stories/decorators/withFixtures.js'

describe('withFixtures', () => {
  test('resolveScenario returns a matching handler bundle for a known name', () => {
    expect(resolveScenario('admin-populated').length).toBeGreaterThan(0)
  })

  test('resolveScenario returns an empty bundle for an unknown name', () => {
    expect(resolveScenario('does-not-exist')).toEqual([])
  })

  test('resetAllSingletons restores admin rune singletons to defaults', () => {
    adminState.currentSection = 'billing'
    adminState.lastRefreshedAt = 123
    adminGlobals.window = '7d'
    adminGlobals.fetchedAt = 456

    resetAllSingletons()

    const section: string = adminState.currentSection
    const windowValue: string = adminGlobals.window
    expect(section).toBe('overview')
    expect(adminState.lastRefreshedAt).toBeNull()
    expect(windowValue).toBe('30d')
    expect(adminGlobals.fetchedAt).toBeNull()
    expect(adminGlobals.data).toBeNull()
  })
})
