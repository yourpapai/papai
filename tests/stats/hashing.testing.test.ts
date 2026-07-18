// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetStatsSaltCacheForTesting } from '../../src/stats/hashing.js'
import { resetStatsSaltCacheForTesting as shimmedReset } from '../../src/stats/hashing.testing.js'

test('hashing.testing shim re-exports the production seam', () => {
  expect(shimmedReset).toBe(resetStatsSaltCacheForTesting)
})
