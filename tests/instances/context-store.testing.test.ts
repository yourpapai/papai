// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { listContextsByPlatformInstance, listContextsByTaskInstance } from '../../src/instances/context-store.js'
import {
  listContextsByPlatformInstance as shimmedByPlatform,
  listContextsByTaskInstance as shimmedByTask,
} from '../../src/instances/context-store.testing.js'

test('context-store.testing shim re-exports the production seams', () => {
  expect(shimmedByTask).toBe(listContextsByTaskInstance)
  expect(shimmedByPlatform).toBe(listContextsByPlatformInstance)
})
