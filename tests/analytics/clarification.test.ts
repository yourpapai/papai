// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { detectClarification } from '../../src/analytics/clarification.js'
import type { ClarificationSignal } from '../../src/analytics/clarification.js'

const signal = (type: string, code: string): ClarificationSignal => ({ type, code })

describe('structured signals only', () => {
  test('missing-required and validation-failed map to missing_required_input', () => {
    const missing = detectClarification([signal('validation', 'missing-required')])
    expect(missing.detection.reason).toBe('missing_required_input')
    expect(missing.detection.detector).toBe('structured_clarification_v1')
    const failed = detectClarification([signal('provider', 'validation-failed')])
    expect(failed.detection.reason).toBe('missing_required_input')
  })

  test('bounded not-found codes map to ambiguous_target', () => {
    for (const code of [
      'task-not-found',
      'project-not-found',
      'status-not-found',
      'link-type-not-found',
      'not-found',
    ]) {
      expect(detectClarification([signal('provider', code)]).detection.reason).toBe('ambiguous_target')
    }
  })

  test('invalid-input, workflow-validation-failed, and unsupported-operation map to ambiguous_action', () => {
    expect(detectClarification([signal('validation', 'invalid-input')]).detection.reason).toBe('ambiguous_action')
    expect(detectClarification([signal('provider', 'workflow-validation-failed')]).detection.reason).toBe(
      'ambiguous_action',
    )
    expect(detectClarification([signal('provider', 'unsupported-operation')]).detection.reason).toBe('ambiguous_action')
  })

  test('access-denied and auth-failed map to permission', () => {
    expect(detectClarification([signal('provider', 'access-denied')]).detection.reason).toBe('permission')
    expect(detectClarification([signal('provider', 'auth-failed')]).detection.reason).toBe('permission')
  })

  test('config-missing maps to configuration', () => {
    expect(detectClarification([signal('system', 'config-missing')]).detection.reason).toBe('configuration')
  })

  test('operational failures produce no clarification signal', () => {
    for (const candidate of [
      signal('llm', 'rate-limited'),
      signal('llm', 'timeout'),
      signal('system', 'network-error'),
      signal('provider', 'unknown'),
      signal('tool-execution', 'interrupted'),
      signal('web-fetch', 'upstream-error'),
    ]) {
      expect(detectClarification([candidate]).detection.reason).toBeNull()
    }
  })

  test('an empty signal list produces no detection', () => {
    const result = detectClarification([])
    expect(result.detection.reason).toBeNull()
    expect(result.coverage.evaluated).toBe(0)
    expect(result.coverage.matched).toBe(0)
    expect(result.coverage.unmatchedCodes).toEqual([])
  })

  test('the first matched signal wins and coverage counts every evaluated signal', () => {
    const result = detectClarification([
      signal('llm', 'timeout'),
      signal('provider', 'task-not-found'),
      signal('provider', 'auth-failed'),
    ])
    expect(result.detection.reason).toBe('ambiguous_target')
    expect(result.detection.matchedCode).toBe('task-not-found')
    expect(result.coverage.evaluated).toBe(3)
    expect(result.coverage.matched).toBe(2)
    expect(result.coverage.unmatchedCodes).toEqual(['timeout'])
  })

  test('coverage dedupes and sorts unmatched codes so undercounting is visible', () => {
    const result = detectClarification([
      signal('system', 'network-error'),
      signal('llm', 'timeout'),
      signal('system', 'network-error'),
    ])
    expect(result.detection.reason).toBeNull()
    expect(result.coverage.evaluated).toBe(3)
    expect(result.coverage.matched).toBe(0)
    expect(result.coverage.unmatchedCodes).toEqual(['network-error', 'timeout'])
  })

  test('the detector inspects no message or reason text', () => {
    const missingWithText = {
      type: 'validation',
      code: 'missing-required',
      message: 'the user forgot their API token sk-live-123',
    }
    const unknownWithText = {
      type: 'provider',
      code: 'unknown',
      message: 'please rephrase your request about secret-project',
    }
    const withText: ClarificationSignal[] = [missingWithText, unknownWithText]
    const result = detectClarification(withText)
    expect(result.detection.reason).toBe('missing_required_input')
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('sk-live-123')
    expect(serialized).not.toContain('secret-project')
    expect(serialized).not.toContain('rephrase')
  })
})
