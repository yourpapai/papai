// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { LOG_CAP } from '../../../client/debug/handlers.js'
import { LOG_CAP as shimmedLogCap } from '../../../client/debug/handlers.testing.js'

test('handlers.testing shim re-exports the production seam', () => {
  expect(shimmedLogCap).toBe(LOG_CAP)
})
