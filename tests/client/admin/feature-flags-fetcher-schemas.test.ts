// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AdminFeatureFlagRowSchema,
  AdminFeatureFlagsSnapshotSchema,
  AdminFeatureFlagStateSchema,
} from '../../../client/admin/feature-flags-fetcher-schemas.js'

describe('AdminFeatureFlagStateSchema', () => {
  test('parses valid flag state', () => {
    const result = AdminFeatureFlagStateSchema.safeParse({
      result_compaction: true,
      progressive_disclosure: false,
      semantic_tool_retrieval: false,
    })
    expect(result.success).toBe(true)
  })

  test('rejects missing fields', () => {
    const result = AdminFeatureFlagStateSchema.safeParse({ result_compaction: true })
    expect(result.success).toBe(false)
  })

  test('rejects wrong-type field', () => {
    const result = AdminFeatureFlagStateSchema.safeParse({
      result_compaction: 'true',
      progressive_disclosure: false,
      semantic_tool_retrieval: false,
    })
    expect(result.success).toBe(false)
  })
})

describe('AdminFeatureFlagRowSchema', () => {
  test('parses valid user row', () => {
    const result = AdminFeatureFlagRowSchema.safeParse({
      contextId: 'pi:cGktMQ:ctx:dS0x',
      kind: 'user',
      label: 'alice',
      platformInstanceLabel: 'pi-1',
      flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
    })
    expect(result.success).toBe(true)
  })

  test('rejects invalid kind', () => {
    const result = AdminFeatureFlagRowSchema.safeParse({
      contextId: 'ctx',
      kind: 'admin',
      label: 'x',
      platformInstanceLabel: 'p',
      flags: { result_compaction: false, progressive_disclosure: false, semantic_tool_retrieval: false },
    })
    expect(result.success).toBe(false)
  })
})

describe('AdminFeatureFlagsSnapshotSchema', () => {
  test('parses empty contexts', () => {
    const result = AdminFeatureFlagsSnapshotSchema.safeParse({ killSwitchEngaged: false, contexts: [] })
    expect(result.success).toBe(true)
  })

  test('parses snapshot with contexts', () => {
    const result = AdminFeatureFlagsSnapshotSchema.parse({
      killSwitchEngaged: false,
      contexts: [
        {
          contextId: 'pi:cGktMQ:ctx:dS0x',
          kind: 'user',
          label: 'alice',
          platformInstanceLabel: 'pi-1',
          flags: { result_compaction: true, progressive_disclosure: false, semantic_tool_retrieval: false },
        },
      ],
    })
    expect(result.contexts).toHaveLength(1)
    expect(result.contexts[0]?.label).toBe('alice')
  })

  test('rejects missing killSwitchEngaged', () => {
    const result = AdminFeatureFlagsSnapshotSchema.safeParse({ contexts: [] })
    expect(result.success).toBe(false)
  })
})
