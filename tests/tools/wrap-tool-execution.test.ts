import { describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { wrapToolExecution } from '../../src/tools/wrap-tool-execution.js'

// Interface matching the error result structure
interface ToolErrorResult {
  success: false
  error: string
  toolName: string
  toolCallId: string
  timestamp: string
}

// Type guard for validating ToolErrorResult in tests
function isToolErrorResult(value: unknown): value is ToolErrorResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    value.success === false &&
    'error' in value &&
    typeof value.error === 'string' &&
    'toolName' in value &&
    typeof value.toolName === 'string' &&
    'toolCallId' in value &&
    typeof value.toolCallId === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string'
  )
}

describe('isToolErrorResult', () => {
  test('returns true for valid ToolErrorResult', () => {
    const result = {
      success: false as const,
      error: 'Something failed',
      toolName: 'test_tool',
      toolCallId: 'call-1',
      timestamp: '2024-01-01T00:00:00.000Z',
    }
    expect(isToolErrorResult(result)).toBe(true)
  })

  test('returns false for non-error result', () => {
    const result = { success: true, data: 'ok' }
    expect(isToolErrorResult(result)).toBe(false)
  })

  test('returns false for null', () => {
    expect(isToolErrorResult(null)).toBe(false)
  })

  test('returns false for undefined', () => {
    expect(isToolErrorResult(undefined)).toBe(false)
  })

  test('returns false for missing required fields', () => {
    expect(isToolErrorResult({ success: false })).toBe(false)
    expect(isToolErrorResult({ success: false, error: 'fail' })).toBe(false)
    expect(isToolErrorResult({ success: false, error: 'fail', toolName: 'test' })).toBe(false)
  })
})

describe('wrapToolExecution', () => {
  test('returns result when execution succeeds', async () => {
    const execute = (): Promise<{ success: boolean; data: string }> =>
      Promise.resolve({ success: true, data: 'result' })
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    expect(result).toEqual({ success: true, data: 'result' })
  })

  test('returns structured error when execution throws', async () => {
    const execute = (): Promise<never> => Promise.reject(new Error('Something went wrong'))
    const wrapped = wrapToolExecution(execute, 'test_tool')

    const result = await wrapped({}, { toolCallId: 'call-1', messages: [] })

    // Use assert to validate and narrow the result type
    assert(isToolErrorResult(result), 'expected a ToolErrorResult')
    expect(result.success).toBe(false)
    expect(result.error).toBe('Something went wrong')
    expect(result.toolName).toBe('test_tool')
    expect(result.toolCallId).toBe('call-1')
    expect(typeof result.timestamp).toBe('string')
  })
})
