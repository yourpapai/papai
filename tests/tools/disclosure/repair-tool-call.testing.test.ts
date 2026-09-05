// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { createRepairToolCall } from '../../../src/tools/disclosure/repair-tool-call.js'
import { createRepairToolCall as shimmedCreateRepairToolCall } from '../../../src/tools/disclosure/repair-tool-call.testing.js'

test('repair-tool-call.testing shim re-exports the production seam', () => {
  expect(shimmedCreateRepairToolCall).toBe(createRepairToolCall)
})
