// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { KnownGroupContext } from '../../src/group-settings/types.js'

describe('group-settings/types', () => {
  test('KnownGroupContext shape is structurally valid', () => {
    const ctx: KnownGroupContext = {
      contextId: 'ctx-1',
      provider: 'telegram',
      displayName: 'Test Group',
      parentName: null,
      firstSeenAt: '2026-01-01T00:00:00.000Z',
      lastSeenAt: '2026-01-01T00:00:00.000Z',
    }
    expect(ctx.contextId).toBe('ctx-1')
  })
})
