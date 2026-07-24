// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { toMemoryScope } from '../../../src/debug/settings/memory-scope.js'

describe('toMemoryScope', () => {
  test('maps a personal context scope to a MemoryScope', () => {
    expect(toMemoryScope({ contextId: 'ctx-personal', kind: 'personal' })).toEqual({
      scopeId: 'ctx-personal',
      scopeType: 'personal',
    })
  })

  test('maps a group context scope to a MemoryScope', () => {
    expect(toMemoryScope({ contextId: 'ctx-group', kind: 'group' })).toEqual({
      scopeId: 'ctx-group',
      scopeType: 'group',
    })
  })
})
