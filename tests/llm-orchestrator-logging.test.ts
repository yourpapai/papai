// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { emitLlmError, logProcessMessage } from '../src/llm-orchestrator-logging.js'
import { mockLogger } from './utils/test-helpers.js'

describe('llm-orchestrator-logging', () => {
  test('emitLlmError is a callable function', () => {
    // Verify the module exports the expected functions — integration coverage
    // lives in llm-orchestrator-support.test.ts via the re-export.
    expect(typeof emitLlmError).toBe('function')
  })

  test('logProcessMessage calls logger without throwing', () => {
    mockLogger()
    expect(() => {
      logProcessMessage('ctx-1', 'cfg-1', 'user-1', 'hello', [], 'turn-1')
    }).not.toThrow()
  })
})
