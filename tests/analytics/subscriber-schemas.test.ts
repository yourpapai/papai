// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  attemptIdentityOf,
  DisclosureFallbackDataSchema,
  LlmEndDataSchema,
  LlmErrorDataSchema,
  ToolCompletedDataSchema,
  ToolIdentitySchema,
} from '../../src/analytics/subscriber-schemas.js'

describe('subscriber event data schemas', () => {
  test('attempt identity defaults to ordinal 0, main role, and unmapped binding', () => {
    expect(attemptIdentityOf('turn-1', {})).toEqual({
      rawAttemptId: 'turn-1:main:0',
      providerBinding: 'unmapped',
      modelRole: 'main',
    })
    expect(attemptIdentityOf('turn-1', { attemptOrdinal: 2, modelRole: 'small', providerBinding: 'byok' })).toEqual({
      rawAttemptId: 'turn-1:small:2',
      providerBinding: 'byok',
      modelRole: 'small',
    })
  })

  test('llm:end data requires the controlled fields and catches unknown finish reasons', () => {
    const parsed = LlmEndDataSchema.safeParse({
      model: 'gpt-x',
      steps: 1,
      totalDuration: 12,
      finishReason: 'something-unbounded',
    })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.finishReason).toBe('unknown')
    expect(
      LlmEndDataSchema.safeParse({ model: 'gpt-x', steps: -1, totalDuration: 12, finishReason: 'stop' }).success,
    ).toBe(false)
  })

  test('tool identity accepts the lifecycle analyticsSourceId and rejects empty tool names', () => {
    const parsed = ToolIdentitySchema.safeParse({ toolName: 'create_task', toolCallId: 'tc1', argsBytes: 4 })
    expect(parsed.success).toBe(true)
    expect(ToolIdentitySchema.safeParse({ toolName: '', toolCallId: 'tc1', argsBytes: 4 }).success).toBe(false)
    const withSourceId = ToolIdentitySchema.safeParse({
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      analyticsSourceId: 'turn-1:tc1',
    })
    expect(withSourceId.success).toBe(true)
    expect(withSourceId.data?.analyticsSourceId).toBe('turn-1:tc1')
  })

  test('tool completed data requires the bounded terminal classification fields', () => {
    const valid = ToolCompletedDataSchema.safeParse({
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      durationMs: 9,
      executionOutcome: 'semantic_success',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    })
    expect(valid.success).toBe(true)
    const dynamicOutcome = ToolCompletedDataSchema.safeParse({
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      durationMs: 9,
      executionOutcome: 'kinda_worked',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    })
    expect(dynamicOutcome.success).toBe(false)
  })

  test('tool completed rounds float durationMs to the nearest integer (half up)', () => {
    const base = {
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      executionOutcome: 'semantic_success',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    }
    const floor = ToolCompletedDataSchema.safeParse({ ...base, durationMs: 9.4 })
    expect(floor.success).toBe(true)
    expect(floor.data?.durationMs).toBe(9)
    const half = ToolCompletedDataSchema.safeParse({ ...base, durationMs: 12.5 })
    expect(half.success).toBe(true)
    expect(half.data?.durationMs).toBe(13)
  })

  test('tool completed still rejects negative and NaN durationMs', () => {
    const base = {
      toolName: 'create_task',
      toolCallId: 'tc1',
      argsBytes: 4,
      executionOutcome: 'semantic_success',
      resultBytes: 2,
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    }
    expect(ToolCompletedDataSchema.safeParse({ ...base, durationMs: -1 }).success).toBe(false)
    expect(ToolCompletedDataSchema.safeParse({ ...base, durationMs: Number.NaN }).success).toBe(false)
  })

  test('llm:error rounds float durationMs and rejects negatives', () => {
    const parsed = LlmErrorDataSchema.safeParse({ model: 'gpt-x', durationMs: 100.4 })
    expect(parsed.success).toBe(true)
    expect(parsed.data?.durationMs).toBe(100)
    expect(LlmErrorDataSchema.safeParse({ model: 'gpt-x', durationMs: -1 }).success).toBe(false)
  })

  test('disclosure fallback rejects dynamic reasons', () => {
    expect(DisclosureFallbackDataSchema.safeParse({ stepNumber: 2, reason: 'no_real_load' }).success).toBe(true)
    expect(DisclosureFallbackDataSchema.safeParse({ stepNumber: 2, reason: 'meta_tool_churn' }).success).toBe(true)
    expect(DisclosureFallbackDataSchema.safeParse({ stepNumber: 2, reason: 'model_got_bored' }).success).toBe(false)
  })
})
