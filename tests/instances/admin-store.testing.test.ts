// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { listAdminsForPlatform } from '../../src/instances/admin-store.js'
import { listAdminsForPlatform as shimmedListAdminsForPlatform } from '../../src/instances/admin-store.testing.js'

test('admin-store.testing shim re-exports the production seam', () => {
  expect(shimmedListAdminsForPlatform).toBe(listAdminsForPlatform)
})
