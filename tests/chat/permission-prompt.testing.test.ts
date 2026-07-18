// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetPermissionPromptForTesting } from '../../src/chat/permission-prompt.js'
import { resetPermissionPromptForTesting as shimmedReset } from '../../src/chat/permission-prompt.testing.js'

test('permission-prompt.testing shim re-exports the production seam', () => {
  expect(shimmedReset).toBe(resetPermissionPromptForTesting)
})
