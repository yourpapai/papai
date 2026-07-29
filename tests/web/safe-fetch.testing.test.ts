// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { setAssertPublicUrlForTesting } from '../../src/web/safe-fetch.js'
import { setAssertPublicUrlForTesting as shimmedSet } from '../../src/web/safe-fetch.testing.js'

test('safe-fetch.testing shim re-exports the production seam', () => {
  expect(shimmedSet).toBe(setAssertPublicUrlForTesting)
})
