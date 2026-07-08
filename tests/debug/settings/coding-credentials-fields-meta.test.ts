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

  test('mcp namespace declares upstream_url, upstream_header, upstream_token fields', () => {
    const keys = FIELDS_META.mcp.map((field) => field.key)
    expect(keys).toEqual(['upstream_url', 'upstream_header', 'upstream_token'])
  })

  test('mcp upstream_url and upstream_token are required and upstream_token is sensitive', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['upstream_url']?.required).toBe(true)
    expect(byKey['upstream_token']?.required).toBe(true)
    expect(byKey['upstream_token']?.sensitive).toBe(true)
    expect(byKey['upstream_header']?.required).toBe(false)
  })

  test('mcp fields have user-facing labels and correct sensitivity/control', () => {
    const byKey = Object.fromEntries(FIELDS_META.mcp.map((field) => [field.key, field]))
    expect(byKey['upstream_url']?.label).toBe('Upstream MCP URL')
    expect(byKey['upstream_url']?.sensitive).toBe(false)
    expect(byKey['upstream_url']?.control).toBeUndefined()

    expect(byKey['upstream_header']?.label).toBe('Auth header')
    expect(byKey['upstream_header']?.sensitive).toBe(false)
    expect(byKey['upstream_header']?.control).toBeUndefined()

    expect(byKey['upstream_token']?.label).toBe('Credential')
    expect(byKey['upstream_token']?.sensitive).toBe(true)
  })
})
