// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ExecutionEventPropsSchemas } from '../../src/analytics/event-props-execution.js'

const validToolStartedProps = {
  tool_slug: 'create_task',
  tool_key: 'v1.p-tool',
  origin: 'core',
  domain: 'diagnostics',
  risk: 'read',
  model_role: 'main',
  args_bytes: '0',
} as const

const validToolCompletedProps = {
  ...validToolStartedProps,
  duration_ms: 12,
  execution_outcome: 'semantic_success',
  result_bytes: '0',
  error_class: null,
  status_class: 'none',
  retryable: null,
  recovered_same_turn: false,
} as const

describe('tool fact props domain enum', () => {
  test('tool_started accepts the diagnostics domain', () => {
    const result = ExecutionEventPropsSchemas.tool_started.safeParse(validToolStartedProps)
    expect(result.success).toBe(true)
  })

  test('tool_completed accepts the diagnostics domain', () => {
    const result = ExecutionEventPropsSchemas.tool_completed.safeParse(validToolCompletedProps)
    expect(result.success).toBe(true)
  })

  test('tool_started rejects a bogus domain', () => {
    const result = ExecutionEventPropsSchemas.tool_started.safeParse({
      ...validToolStartedProps,
      domain: 'diagnosticss',
    })
    expect(result.success).toBe(false)
  })

  test('tool_completed rejects a bogus domain', () => {
    const result = ExecutionEventPropsSchemas.tool_completed.safeParse({
      ...validToolCompletedProps,
      domain: 'not-a-domain',
    })
    expect(result.success).toBe(false)
  })
})
