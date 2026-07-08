// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CODING_NAMESPACES } from '../../../src/coding-credentials/types.js'
import { FIELDS_META } from '../../../src/debug/settings/coding-credentials-fields-meta.js'

describe('FIELDS_META', () => {
  test('declares field metadata for every coding-credentials namespace', () => {
    for (const namespace of CODING_NAMESPACES) {
      expect(FIELDS_META[namespace].length).toBeGreaterThan(0)
    }
  })

  test('mcp namespace declares server and upstream_token fields', () => {
    const keys = FIELDS_META.mcp.map((field) => field.key)
    expect(keys).toEqual(['server', 'upstream_token'])
  })

  test('mcp server and upstream_token are required and upstream_token is sensitive', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['server']?.required).toBe(true)
    expect(byKey['upstream_token']?.required).toBe(true)
    expect(byKey['upstream_token']?.sensitive).toBe(true)
  })

  test('mcp fields have user-facing labels and correct sensitivity/control', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['server']?.label).toBe('MCP server')
    expect(byKey['server']?.sensitive).toBe(false)
    expect(byKey['server']?.control).toBe('select')

    expect(byKey['upstream_token']?.label).toBe('Credential')
    expect(byKey['upstream_token']?.sensitive).toBe(true)
  })
})
