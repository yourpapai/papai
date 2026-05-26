// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { isBuiltinTaskType } from '../../src/instances/types.js'

describe('isBuiltinTaskType', () => {
  test('returns true for built-in provider types', () => {
    expect(isBuiltinTaskType('kaneo')).toBe(true)
    expect(isBuiltinTaskType('youtrack')).toBe(true)
  })

  test('returns false for contributed/unknown provider types', () => {
    expect(isBuiltinTaskType('demo-tracker')).toBe(false)
    expect(isBuiltinTaskType('')).toBe(false)
    expect(isBuiltinTaskType('Kaneo')).toBe(false)
  })
})
