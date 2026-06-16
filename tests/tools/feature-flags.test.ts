// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { setCachedConfig } from '../../src/cache.js'
import { getConfigContextIdFromStorageContextId, toScopedThreadContextId } from '../../src/chat/scoped-context.js'
import {
  parseReductionFlagsJson,
  REDUCTION_FLAGS_CONFIG_KEY,
  resolveReductionFlags,
} from '../../src/tools/feature-flags.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ALL_OFF = {
  progressiveDisclosure: false,
  resultCompaction: false,
  semanticToolRetrieval: false,
  crossThreadMemory: false,
}

// Unique context per test: the in-memory config cache outlives individual tests.
let ctxCounter = 0
const freshCtx = (): string => `ff-ctx-${++ctxCounter}`

describe('resolveReductionFlags', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    delete process.env['TOOL_CONTEXT_REDUCTION_DISABLED']
  })

  it('defaults every flag to false when no config present', () => {
    expect(resolveReductionFlags(freshCtx())).toEqual(ALL_OFF)
  })

  it('reads per-context overrides from the reserved key', () => {
    const ctx = freshCtx()
    // Pin the literal key so a constant-mutation can't satisfy both sides simultaneously
    expect(REDUCTION_FLAGS_CONFIG_KEY).toBe('tool_context_flags')
    setCachedConfig(ctx, 'tool_context_flags', JSON.stringify({ result_compaction: true }))
    expect(resolveReductionFlags(ctx).resultCompaction).toBe(true)
  })

  it('reads progressive_disclosure flag independently', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify({ progressive_disclosure: true }))
    const flags = resolveReductionFlags(ctx)
    expect(flags.progressiveDisclosure).toBe(true)
    expect(flags.resultCompaction).toBe(false)
    expect(flags.semanticToolRetrieval).toBe(false)
  })

  it('reads semantic_tool_retrieval flag independently', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify({ semantic_tool_retrieval: true }))
    const flags = resolveReductionFlags(ctx)
    expect(flags.semanticToolRetrieval).toBe(true)
    expect(flags.progressiveDisclosure).toBe(false)
    expect(flags.resultCompaction).toBe(false)
  })

  it('returns all-false when config value is a JSON array (not a record)', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify([{ result_compaction: true }]))
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('returns all-false when config value is a JSON string (not a record)', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify('result_compaction'))
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('returns all-false when config value is an empty string', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, '')
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('returns all-false when config value is whitespace-only', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, '   ')
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('treats non-boolean true values as false for flags', () => {
    const ctx = freshCtx()
    setCachedConfig(
      ctx,
      REDUCTION_FLAGS_CONFIG_KEY,
      JSON.stringify({ result_compaction: 'yes', progressive_disclosure: 1 }),
    )
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('kill switch forces every flag OFF regardless of config', () => {
    const ctx = freshCtx()
    process.env['TOOL_CONTEXT_REDUCTION_DISABLED'] = 'true'
    setCachedConfig(
      ctx,
      REDUCTION_FLAGS_CONFIG_KEY,
      JSON.stringify({ result_compaction: true, progressive_disclosure: true }),
    )
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('ignores corrupt JSON and returns all-false', () => {
    const ctx = freshCtx()
    setCachedConfig(ctx, REDUCTION_FLAGS_CONFIG_KEY, '{not json')
    expect(resolveReductionFlags(ctx)).toEqual(ALL_OFF)
  })

  it('reads flags from the derived config context id, not the thread-scoped id', () => {
    const threadScopedId = toScopedThreadContextId({
      platformInstanceId: 'plat-1',
      nativeContextId: `grp-${freshCtx()}`,
      threadId: 'thread-7',
    })
    const configContextId = getConfigContextIdFromStorageContextId(threadScopedId)
    expect(configContextId).not.toBe(threadScopedId)

    // Flags stored under the raw thread-scoped id must NOT be picked up...
    setCachedConfig(threadScopedId, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify({ result_compaction: true }))
    expect(resolveReductionFlags(threadScopedId)).toEqual(ALL_OFF)

    // ...while flags under the derived config context id are.
    setCachedConfig(configContextId, REDUCTION_FLAGS_CONFIG_KEY, JSON.stringify({ result_compaction: true }))
    expect(resolveReductionFlags(threadScopedId).resultCompaction).toBe(true)
  })
})

describe('parseReductionFlagsJson', () => {
  it('parses only literal true values', () => {
    const flags = parseReductionFlagsJson(
      '{"result_compaction":true,"progressive_disclosure":"true","semantic_tool_retrieval":1}',
    )
    expect(flags).toEqual({
      resultCompaction: true,
      progressiveDisclosure: false,
      semanticToolRetrieval: false,
      crossThreadMemory: false,
    })
  })

  it('returns all OFF for null, empty, and corrupt input', () => {
    const allOff = {
      resultCompaction: false,
      progressiveDisclosure: false,
      semanticToolRetrieval: false,
      crossThreadMemory: false,
    }
    expect(parseReductionFlagsJson(null)).toEqual(allOff)
    expect(parseReductionFlagsJson('')).toEqual(allOff)
    expect(parseReductionFlagsJson('{not json')).toEqual(allOff)
    expect(parseReductionFlagsJson('[1,2]')).toEqual(allOff)
  })
})
