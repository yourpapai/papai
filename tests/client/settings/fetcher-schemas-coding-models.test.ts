// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { CodingModelsResponseSchema } from '../../../client/settings/fetcher-schemas-coding-models.js'

describe('CodingModelsResponseSchema', () => {
  test('parses ok:true with models', () => {
    const result = CodingModelsResponseSchema.parse({
      ok: true,
      models: [{ value: 'claude-sonnet-4-6', label: 'claude-sonnet-4-6' }],
    })
    expect(result.ok).toBe(true)
    expect(result.models).toHaveLength(1)
    expect(result.models[0]!.value).toBe('claude-sonnet-4-6')
  })

  test('parses ok:false with empty models', () => {
    const result = CodingModelsResponseSchema.parse({ ok: false, models: [] })
    expect(result.ok).toBe(false)
    expect(result.models).toEqual([])
  })

  test('rejects missing models array', () => {
    expect(CodingModelsResponseSchema.safeParse({ ok: true }).success).toBe(false)
  })
})
