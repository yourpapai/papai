// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { routeRequestForTest } from '../../src/debug/server.js'
import { routeRequestForTest as shimmedRouteRequestForTest } from '../../src/debug/server.testing.js'

test('server.testing shim re-exports the production seam', () => {
  expect(shimmedRouteRequestForTest).toBe(routeRequestForTest)
})
