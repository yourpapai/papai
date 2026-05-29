// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { platformInstanceSchema } from '../../src/debug/instance-route-support.js'

describe('platformInstanceSchema', () => {
  test('accepts kontur-talk type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'kontur-talk-default',
      type: 'kontur-talk',
      config: { jwtToken: 'test-token' },
    })
    expect(result.success).toBe(true)
  })

  test('accepts telegram type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'telegram-default',
      type: 'telegram',
      config: { token: 'test-token' },
    })
    expect(result.success).toBe(true)
  })

  test('rejects unknown type', () => {
    const result = platformInstanceSchema.safeParse({
      id: 'test-default',
      type: 'unknown',
      config: {},
    })
    expect(result.success).toBe(false)
  })
})
