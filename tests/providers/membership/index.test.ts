// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ensureWorkspaceMember, defaultMembershipDeps } from '../../../src/providers/membership/index.js'

describe('membership/index barrel', () => {
  test('exports ensureWorkspaceMember', () => {
    expect(typeof ensureWorkspaceMember).toBe('function')
  })

  test('exports defaultMembershipDeps', () => {
    expect(defaultMembershipDeps).toBeDefined()
    expect(typeof defaultMembershipDeps.resolveProvider).toBe('function')
    expect(typeof defaultMembershipDeps.getContextSettings).toBe('function')
    expect(typeof defaultMembershipDeps.resolveUserLabel).toBe('function')
  })
})
