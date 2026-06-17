// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ToolPresetSchema, ToolsResponseSchema } from '../../../client/settings/fetcher-schemas-tools.js'

describe('ToolPresetSchema', () => {
  test('accepts valid preset values', () => {
    expect(ToolPresetSchema.parse('allow-all')).toBe('allow-all')
    expect(ToolPresetSchema.parse('non-destructive')).toBe('non-destructive')
    expect(ToolPresetSchema.parse('read-only')).toBe('read-only')
  })

  test('rejects unknown preset values', () => {
    expect(ToolPresetSchema.safeParse('bogus').success).toBe(false)
    expect(ToolPresetSchema.safeParse('').success).toBe(false)
  })
})

describe('ToolsResponseSchema', () => {
  test('parses domains and tool risk (three-state model)', () => {
    const parsed = ToolsResponseSchema.parse({
      contextId: 'user:1',
      domains: [
        { domain: 'task', summary: 'partial', tools: [{ name: 'create_task', permission: 'allow', risk: 'write' }] },
      ],
    })
    expect(parsed.domains[0]!.summary).toBe('partial')
    expect(parsed.domains[0]!.tools[0]!.permission).toBe('allow')
    expect(parsed.domains[0]!.tools[0]!.risk).toBe('write')
  })
})

describe('ToolsResponseSchema activePreset', () => {
  test('defaults activePreset to null when omitted', () => {
    const parsed = ToolsResponseSchema.parse({ contextId: 'x', domains: [] })
    expect(parsed.activePreset).toBeNull()
  })

  test('accepts a valid activePreset value', () => {
    const parsed = ToolsResponseSchema.parse({ contextId: 'x', domains: [], activePreset: 'read-only' })
    expect(parsed.activePreset).toBe('read-only')
  })

  test('accepts null activePreset explicitly', () => {
    const parsed = ToolsResponseSchema.parse({ contextId: 'x', domains: [], activePreset: null })
    expect(parsed.activePreset).toBeNull()
  })
})
