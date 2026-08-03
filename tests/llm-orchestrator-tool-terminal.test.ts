// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { classifyToolTerminal } from '../src/llm-orchestrator-tool-terminal.js'
import type { ToolFailureResult } from '../src/tool-failure.js'
import { buildPermissionDenied } from '../src/tools/permission-gate.js'
const failure = (overrides: Partial<ToolFailureResult>): ToolFailureResult => ({
  success: false,
  error: 'boom',
  toolName: 'get_task',
  toolCallId: 'tc1',
  timestamp: '2026-07-25T00:00:00.000Z',
  errorType: 'tool-execution',
  errorCode: 'unknown',
  userMessage: 'boom',
  agentMessage: 'boom',
  retryable: false,
  ...overrides,
})

describe('classifyToolTerminal', () => {
  test('a successful non-failure output is semantic success with no error class', () => {
    expect(classifyToolTerminal({ success: true, output: { ok: true } }, null)).toEqual({
      outcome: 'semantic_success',
      errorClass: null,
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    })
  })

  test('an SDK-successful structured failure maps bounded error and status classes', () => {
    expect(
      classifyToolTerminal(
        { success: true, output: { task: null } },
        failure({ errorCode: 'task-not-found', errorType: 'provider', retryable: false, recovered: true }),
      ),
    ).toEqual({
      outcome: 'structured_failure',
      errorClass: 'not_found',
      statusClass: 'other',
      retryable: false,
      recoveredSameTurn: true,
    })
  })

  test('a permission-denied output is its own outcome without an http-style status', () => {
    expect(classifyToolTerminal({ success: true, output: buildPermissionDenied('no') }, null)).toEqual({
      outcome: 'permission_denied',
      errorClass: 'permission',
      statusClass: 'none',
      retryable: null,
      recoveredSameTurn: false,
    })
  })

  test('a thrown failure without classification falls back to internal', () => {
    expect(classifyToolTerminal({ success: false, output: undefined }, null)).toEqual({
      outcome: 'thrown_failure',
      errorClass: 'internal',
      statusClass: 'other',
      retryable: null,
      recoveredSameTurn: false,
    })
  })

  test.each([
    ['timeout', 'timeout', 'timeout'],
    ['rate-limited', 'rate_limit', 'other'],
    ['access-denied', 'authorization', 'auth'],
    ['config-missing', 'configuration', 'other'],
    ['network-error', 'network', 'network'],
    ['missing-required', 'validation', 'other'],
    ['interrupted', 'cancelled', 'other'],
  ] as const)('code %s maps to error class %s with status %s', (code, errorClass, statusClass) => {
    const terminal = classifyToolTerminal({ success: false, output: undefined }, failure({ errorCode: code }))
    expect(terminal.errorClass).toBe(errorClass)
    expect(terminal.statusClass).toBe(statusClass)
  })
})
