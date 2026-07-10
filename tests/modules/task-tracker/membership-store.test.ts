// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { taskProviderMembershipStore } from '../../../src/modules/task-tracker/membership-store.js'

describe('taskProviderMembershipStore', () => {
  test('implements the MembershipStore surface', () => {
    expect(typeof taskProviderMembershipStore.ensureMember).toBe('function')
    expect(typeof taskProviderMembershipStore.markMemberInactive).toBe('function')
    expect(typeof taskProviderMembershipStore.runStartupBackfill).toBe('function')
  })
})
