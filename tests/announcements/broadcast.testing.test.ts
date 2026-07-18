// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { defaultBroadcastDepsForTest } from '../../src/announcements/broadcast.js'
import { defaultBroadcastDepsForTest as shimmedDeps } from '../../src/announcements/broadcast.testing.js'

test('broadcast.testing shim re-exports the production seam', () => {
  expect(shimmedDeps).toBe(defaultBroadcastDepsForTest)
})
