// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { syncSectionFromLocation } from '../../../client/admin/admin.svelte.js'
import { syncSectionFromLocation as shimmedSync } from '../../../client/admin/admin.testing.js'

test('admin.testing shim re-exports the production seam', () => {
  expect(shimmedSync).toBe(syncSectionFromLocation)
})
