// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { UserCache } from '../src/cache-types.js'

describe('cache-types', () => {
  test('UserCache shape has no workspaceId field', () => {
    const cache: UserCache = {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      tools: undefined,
      lastAccessed: Date.now(),
    }
    expect('workspaceId' in cache).toBe(false)
  })
})
