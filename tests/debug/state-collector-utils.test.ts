// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import {
  str,
  num,
  bool,
  isTokenRecord,
  tokenUsage,
  parseStepsDetail,
  type StepDetail,
  type StepToolCallDetail,
} from '../../src/debug/state-collector-utils.js'

describe('state-collector-utils', () => {
  describe('str', () => {
    it('should return string value as-is', () => {
      expect(str('hello')).toBe('hello')
    })

    it('should return empty string for non-string values', () => {
      expect(str(123)).toBe('')
      expect(str(null)).toBe('')
      expect(str(undefined)).toBe('')
      expect(str({})).toBe('')
    })
  })

  describe('num', () => {
    it('should return number value as-is', () => {
      expect(num(42)).toBe(42)
    })

    it('should return 0 for non-number values', () => {
      expect(num('123')).toBe(0)
      expect(num(null)).toBe(0)
      expect(num(undefined)).toBe(0)
    })
  })

  describe('bool', () => {
    it('should return boolean value as-is', () => {
      expect(bool(true)).toBe(true)
      expect(bool(false)).toBe(false)
    })

    it('should return false for non-boolean values', () => {
      expect(bool('true')).toBe(false)
      expect(bool(1)).toBe(false)
      expect(bool(null)).toBe(false)
    })
  })

  describe('isTokenRecord', () => {
    it('should return true for token record objects', () => {
      expect(isTokenRecord({ inputTokens: 10, outputTokens: 20 })).toBe(true)
    })

    it('should return false for non-objects or missing properties', () => {
      expect(isTokenRecord(null)).toBe(false)
      expect(isTokenRecord({ inputTokens: 10 })).toBe(false)
      expect(isTokenRecord('string')).toBe(false)
    })
  })

  describe('tokenUsage', () => {
    it('should extract token usage from valid record', () => {
      const result = tokenUsage({ inputTokens: 10, outputTokens: 20 })
      expect(result).toEqual({ inputTokens: 10, outputTokens: 20 })
    })

    it('should return zeros for invalid input', () => {
      expect(tokenUsage(null)).toEqual({ inputTokens: 0, outputTokens: 0 })
      expect(tokenUsage({})).toEqual({ inputTokens: 0, outputTokens: 0 })
    })
  })

  describe('parseStepsDetail', () => {
    it('returns undefined for non-array input', () => {
      expect(parseStepsDetail(undefined)).toBeUndefined()
      expect(parseStepsDetail(null)).toBeUndefined()
      expect(parseStepsDetail('not an array')).toBeUndefined()
    })

    it('parses step number, text and finishReason', () => {
      const result = parseStepsDetail([{ stepNumber: 1, text: 'hi', finishReason: 'stop' }])
      expect(result).toHaveLength(1)
      expect(result?.[0]?.stepNumber).toBe(1)
      expect(result?.[0]?.text).toBe('hi')
      expect(result?.[0]?.finishReason).toBe('stop')
    })

    it('omits empty text and finishReason', () => {
      const result = parseStepsDetail([{ stepNumber: 2, text: '', finishReason: '' }])
      expect(result?.[0]?.text).toBeUndefined()
      expect(result?.[0]?.finishReason).toBeUndefined()
    })

    it('parses tool calls with result and error', () => {
      const result = parseStepsDetail([
        {
          stepNumber: 1,
          toolCalls: [
            { toolName: 'search', toolCallId: 'c-1', args: { q: 'x' }, result: { hits: 2 } },
            { toolName: 'create', toolCallId: 'c-2', args: {}, error: 'denied' },
          ],
        },
      ])
      const calls = result?.[0]?.toolCalls
      expect(calls).toHaveLength(2)
      expect(calls?.[0]?.result).toEqual({ hits: 2 })
      expect(calls?.[0]?.error).toBeUndefined()
      expect(calls?.[1]?.result).toBeUndefined()
      expect(calls?.[1]?.error).toBe('denied')
    })

    it('omits tool calls when input toolCalls is not an array', () => {
      const result = parseStepsDetail([{ stepNumber: 1 }])
      expect(result?.[0]?.toolCalls).toBeUndefined()
    })

    it('StepDetail and StepToolCallDetail types structurally accept parsed values', () => {
      const call: StepToolCallDetail = {
        toolName: 'search',
        toolCallId: 'c-1',
        args: { q: 'hello' },
        result: { hits: 1 },
      }
      const step: StepDetail = {
        stepNumber: 1,
        text: 'hi',
        finishReason: 'stop',
        toolCalls: [call],
        usage: { inputTokens: 1, outputTokens: 2 },
      }
      expect(step.stepNumber).toBe(1)
      expect(step.toolCalls?.[0]?.toolName).toBe('search')
    })
  })
})
