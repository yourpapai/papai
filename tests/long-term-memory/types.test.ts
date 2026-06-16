// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { MemoryStatusSchema } from '../../src/long-term-memory/types.js'

describe('MemoryStatusSchema', () => {
  test('accepts provisional as a valid status', () => {
    expect(MemoryStatusSchema.parse('provisional')).toBe('provisional')
  })

  test('rejects unknown statuses', () => {
    expect(() => MemoryStatusSchema.parse('unknown')).toThrow()
  })

  test('accepts all existing statuses', () => {
    expect(MemoryStatusSchema.parse('active')).toBe('active')
    expect(MemoryStatusSchema.parse('stale')).toBe('stale')
    expect(MemoryStatusSchema.parse('archived')).toBe('archived')
    expect(MemoryStatusSchema.parse('contradicted')).toBe('contradicted')
  })
})
