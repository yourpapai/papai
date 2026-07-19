// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { clearLlmAdminCacheForTesting } from '../../src/llm-providers/store.js'
import { clearLlmAdminCacheForTesting as shimmedClear } from '../../src/llm-providers/store.testing.js'

test('store.testing shim re-exports the production seam', () => {
  expect(shimmedClear).toBe(clearLlmAdminCacheForTesting)
})
