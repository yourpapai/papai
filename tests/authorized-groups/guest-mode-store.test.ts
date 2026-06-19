// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup, isGuestModeEnabled, setGuestMode } from '../../src/authorized-groups.js'
import { setupTestDb } from '../utils/test-helpers.js'

describe('guest mode store', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  test('defaults to false for a newly authorized group', () => {
    addAuthorizedGroup('grp-1', 'admin')
    expect(isGuestModeEnabled('grp-1')).toBe(false)
  })

  test('setGuestMode round-trips', () => {
    addAuthorizedGroup('grp-1', 'admin')
    setGuestMode('grp-1', true)
    expect(isGuestModeEnabled('grp-1')).toBe(true)
    setGuestMode('grp-1', false)
    expect(isGuestModeEnabled('grp-1')).toBe(false)
  })

  test('returns false for an unknown group', () => {
    expect(isGuestModeEnabled('nope')).toBe(false)
  })
})
