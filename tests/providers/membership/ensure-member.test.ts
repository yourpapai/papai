// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TaskCapability } from '../../../src/providers/task-capability.js'
import type { TaskProvider } from '../../../src/providers/types.js'

describe('TaskProvider.provisionWorkspaceMember type contract', () => {
  test('TaskProvider interface includes optional provisionWorkspaceMember', () => {
    // Compile-time check: TaskProvider must have the optional method.
    // The type-level function assignment fails at tsc if the property is missing.
    type HasProvisionMethod = Pick<TaskProvider, 'provisionWorkspaceMember'>
    const check = (_p: HasProvisionMethod): void => {
      expect(_p).toBeDefined()
    }
    // Verify the shape compiles — the function itself is the assertion.
    expect(check).toBeDefined()
  })

  test('capabilities type includes members.provision', () => {
    // Compile-time check — will fail tsc if 'members.provision' is not in TaskCapability.
    const cap: TaskCapability = 'members.provision'
    expect(cap).toBe('members.provision')
  })
})
