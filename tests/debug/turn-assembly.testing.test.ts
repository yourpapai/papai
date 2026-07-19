// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetTurnBuffers } from '../../src/debug/turn-assembly.js'
import { resetTurnBuffers as shimmedResetTurnBuffers } from '../../src/debug/turn-assembly.testing.js'

test('turn-assembly.testing shim re-exports the production seam', () => {
  expect(shimmedResetTurnBuffers).toBe(resetTurnBuffers)
})
