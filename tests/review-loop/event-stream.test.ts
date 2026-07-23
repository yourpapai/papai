// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseEventLine } from '../../review-loop/src/event-stream.js'

describe('parseEventLine', () => {
  test('parses step_start', () => {
    const line = JSON.stringify({ type: 'step_start', timestamp: 1784136381396, part: { type: 'step-start' } })
    expect(parseEventLine(line)).toEqual({ type: 'step_start', timestamp: 1784136381396 })
  })

  test('parses tool_use', () => {
    const line = JSON.stringify({
      type: 'tool_use',
      part: {
        type: 'tool',
        tool: 'read',
        callID: 'call_1',
        state: { status: 'completed', input: { filePath: '/x/a.ts' } },
      },
    })
    expect(parseEventLine(line)).toEqual({
      type: 'tool_use',
      tool: 'read',
      callId: 'call_1',
      status: 'completed',
      input: { filePath: '/x/a.ts' },
    })
  })

  test('parses text', () => {
    const line = JSON.stringify({ type: 'text', part: { type: 'text', text: 'ping' } })
    expect(parseEventLine(line)).toEqual({ type: 'text', text: 'ping' })
  })

  test('parses step_finish', () => {
    const line = JSON.stringify({
      type: 'step_finish',
      part: { type: 'step-finish', reason: 'stop', tokens: { input: 13373, output: 31, reasoning: 0 }, cost: 0 },
    })
    expect(parseEventLine(line)).toEqual({
      type: 'step_finish',
      reason: 'stop',
      tokens: { input: 13373, output: 31, reasoning: 0 },
      cost: 0,
    })
  })

  test('defaults unknown tool status to running', () => {
    const line = JSON.stringify({ type: 'tool_use', part: { type: 'tool', tool: 'bash', callID: 'c', state: {} } })
    expect(parseEventLine(line)).toMatchObject({ type: 'tool_use', status: 'running' })
  })

  test('returns null for malformed JSON', () => {
    expect(parseEventLine('{ not json')).toBeNull()
  })

  test('returns null for empty line', () => {
    expect(parseEventLine('')).toBeNull()
  })

  test('returns null for unknown event type', () => {
    expect(parseEventLine(JSON.stringify({ type: 'mystery', part: {} }))).toBeNull()
  })

  test('returns null when part is missing', () => {
    expect(parseEventLine(JSON.stringify({ type: 'step_start', timestamp: 1 }))).toBeNull()
  })
})
