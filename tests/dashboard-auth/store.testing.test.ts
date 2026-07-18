// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { setStoreDb } from '../../src/dashboard-auth/store.js'
import { setStoreDb as shimmedSetStoreDb } from '../../src/dashboard-auth/store.testing.js'

test('store.testing shim re-exports the production seam', () => {
  expect(shimmedSetStoreDb).toBe(setStoreDb)
})
