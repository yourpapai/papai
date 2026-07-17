// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { emptyFilter } from '../../../client/debug/log-filter-url.js'
import { emptyFilter as shimmedEmptyFilter } from '../../../client/debug/log-filter-url.testing.js'

test('log-filter-url.testing shim re-exports the production seam', () => {
  expect(shimmedEmptyFilter).toBe(emptyFilter)
})
