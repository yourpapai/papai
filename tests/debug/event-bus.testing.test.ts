// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { subscribeCountForTest } from '../../src/debug/event-bus.js'
import { subscribeCountForTest as shimmedSubscribeCountForTest } from '../../src/debug/event-bus.testing.js'

test('event-bus.testing shim re-exports the production seam', () => {
  expect(shimmedSubscribeCountForTest).toBe(subscribeCountForTest)
})
