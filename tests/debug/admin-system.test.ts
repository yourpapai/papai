// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// handleAdminSystem was removed (duplicate of settings admin system route).
// Full coverage of handleAdminRecentRequests lives in admin-system.recent-requests.test.ts.
// This file exists to satisfy the test-resolver contract for admin-system.ts.

import { describe, expect, test } from 'bun:test'

import { handleAdminRecentRequests } from '../../src/debug/admin-system.js'

describe('admin-system module contract', () => {
  test('handleAdminRecentRequests is exported', () => {
    expect(typeof handleAdminRecentRequests).toBe('function')
  })
})
