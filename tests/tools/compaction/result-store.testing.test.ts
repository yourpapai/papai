// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import {
  clearResultStoreForTesting,
  setResultStoreClockForTesting,
} from '../../../src/tools/compaction/result-store.js'
import {
  clearResultStoreForTesting as shimmedClear,
  setResultStoreClockForTesting as shimmedSetClock,
} from '../../../src/tools/compaction/result-store.testing.js'

test('result-store.testing shim re-exports the production seams', () => {
  expect(shimmedSetClock).toBe(setResultStoreClockForTesting)
  expect(shimmedClear).toBe(clearResultStoreForTesting)
})
