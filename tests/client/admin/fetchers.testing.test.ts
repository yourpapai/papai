// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { fetchAdminIdentity } from '../../../client/admin/fetchers.js'
import { fetchAdminIdentity as shimmedFetch } from '../../../client/admin/fetchers.testing.js'

test('fetchers.testing shim re-exports the production seam', () => {
  expect(shimmedFetch).toBe(fetchAdminIdentity)
})
