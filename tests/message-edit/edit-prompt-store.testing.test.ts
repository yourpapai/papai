// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetEditPromptStoreForTesting } from '../../src/message-edit/edit-prompt-store.js'
import { resetEditPromptStoreForTesting as shimmedReset } from '../../src/message-edit/edit-prompt-store.testing.js'

test('edit-prompt-store.testing shim re-exports the production seam', () => {
  expect(shimmedReset).toBe(resetEditPromptStoreForTesting)
})
