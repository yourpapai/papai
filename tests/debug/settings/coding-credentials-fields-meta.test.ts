// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { FIELDS_META } from '../../../src/debug/settings/coding-credentials-fields-meta.js'
import { CODING_NAMESPACES } from '../../../src/modules/coding/credentials/types.js'

describe('FIELDS_META', () => {
  test('declares field metadata for every coding-credentials namespace', () => {
    for (const namespace of CODING_NAMESPACES) {
      expect(FIELDS_META[namespace].length).toBeGreaterThan(0)
    }
  })

  test('mcp namespace declares a single servers field (JSON array vault)', () => {
    const keys = FIELDS_META.mcp.map((field) => field.key)
    expect(keys).toEqual(['servers'])
  })

  test('mcp servers field is optional (row-level validation happens in the array) and sensitive', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['servers']?.required).toBe(false)
    expect(byKey['servers']?.sensitive).toBe(true)
  })

  test('mcp servers field has a user-facing label', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['servers']?.label).toBe('MCP servers')
    expect(byKey['servers']?.sensitive).toBe(true)
  })
})
