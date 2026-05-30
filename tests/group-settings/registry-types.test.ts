// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  UpsertGroupUserObservationInput,
  UpsertKnownGroupContextInput,
} from '../../src/group-settings/registry-types.js'

describe('group-settings/registry-types', () => {
  test('UpsertKnownGroupContextInput shape is structurally valid', () => {
    const input: UpsertKnownGroupContextInput = {
      contextId: 'ctx-1',
      provider: 'telegram',
      displayName: 'Test Group',
      parentName: null,
    }
    expect(input.contextId).toBe('ctx-1')
  })

  test('UpsertGroupUserObservationInput shape is structurally valid', () => {
    const input: UpsertGroupUserObservationInput = {
      provider: 'telegram',
      contextId: 'ctx-1',
      userId: 'u-1',
      username: 'alice',
      displayLabel: 'Alice',
    }
    expect(input.userId).toBe('u-1')
  })
})
