// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetUsageRecorderForTesting } from '../../src/usage/index.js'
import { resetUsageRecorderForTesting as shimmedReset } from '../../src/usage/index.testing.js'

test('index.testing shim re-exports the production seam', () => {
  expect(shimmedReset).toBe(resetUsageRecorderForTesting)
})
