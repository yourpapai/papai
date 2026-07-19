// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { clearGroupAdminLiveCache } from '../../src/chat/group-admin-live.js'
import { clearGroupAdminLiveCache as shimmedClearGroupAdminLiveCache } from '../../src/chat/group-admin-live.testing.js'

test('group-admin-live.testing shim re-exports the production seam', () => {
  expect(shimmedClearGroupAdminLiveCache).toBe(clearGroupAdminLiveCache)
})
