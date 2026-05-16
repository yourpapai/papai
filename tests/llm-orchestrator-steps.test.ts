// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildStepsDetail } from '../src/llm-orchestrator-steps.js'
import type { StepInput } from '../src/llm-orchestrator-types.js'

describe('buildStepsDetail', () => {
  test('numbers steps starting from 1', () => {
    const steps: StepInput[] = [
      { usage: { inputTokens: 10, outputTokens: 5 } },
      { usage: { inputTokens: 20, outputTokens: 8 } },
    ]
    const out = buildStepsDetail(steps)
    expect(out).toHaveLength(2)
    expect(out[0]?.stepNumber).toBe(1)
    expect(out[1]?.stepNumber).toBe(2)
  })

  test('captures text and finishReason when present', () => {
    const steps: StepInput[] = [{ text: 'Calling search', finishReason: 'tool-calls' }]
    const out = buildStepsDetail(steps)
    expect(out[0]?.text).toBe('Calling search')
    expect(out[0]?.finishReason).toBe('tool-calls')
  })

  test('omits empty text and missing finishReason', () => {
    const steps: StepInput[] = [{ text: '' }]
    const out = buildStepsDetail(steps)
    expect(out[0]?.text).toBeUndefined()
    expect(out[0]?.finishReason).toBeUndefined()
  })

  test('merges toolResults into tool calls by toolCallId', () => {
    const steps: StepInput[] = [
      {
        toolCalls: [
          { toolName: 'search', toolCallId: 'call-1', input: { q: 'foo' } },
          { toolName: 'create', toolCallId: 'call-2', input: { title: 'x' } },
        ],
        toolResults: [{ toolCallId: 'call-1', output: { hits: 3 } }],
      },
    ]
    const out = buildStepsDetail(steps)
    const calls = out[0]?.toolCalls
    expect(calls?.[0]?.result).toEqual({ hits: 3 })
    expect(calls?.[1]?.result).toBeUndefined()
    expect(calls?.[0]?.args).toEqual({ q: 'foo' })
  })

  test('extracts tool errors from content parts by toolCallId', () => {
    const steps: StepInput[] = [
      {
        toolCalls: [{ toolName: 'create', toolCallId: 'call-2', input: {} }],
        content: [{ type: 'tool-error', toolCallId: 'call-2', error: new Error('permission denied') }],
      },
    ]
    const out = buildStepsDetail(steps)
    expect(out[0]?.toolCalls?.[0]?.error).toBe('permission denied')
  })

  test('tool error accepts plain string error', () => {
    const steps: StepInput[] = [
      {
        toolCalls: [{ toolName: 'create', toolCallId: 'c-1', input: {} }],
        content: [{ type: 'tool-error', toolCallId: 'c-1', error: 'not found' }],
      },
    ]
    const out = buildStepsDetail(steps)
    expect(out[0]?.toolCalls?.[0]?.error).toBe('not found')
  })

  test('ignores non-tool-error content parts', () => {
    const steps: StepInput[] = [
      {
        toolCalls: [{ toolName: 'search', toolCallId: 'c-1', input: {} }],
        content: [
          { type: 'text', text: 'hello' },
          { type: 'tool-call', toolCallId: 'c-1' },
        ],
      },
    ]
    const out = buildStepsDetail(steps)
    expect(out[0]?.toolCalls?.[0]?.error).toBeUndefined()
  })

  test('handles steps without toolCalls', () => {
    const steps: StepInput[] = [{ text: 'just thinking' }]
    const out = buildStepsDetail(steps)
    expect(out[0]?.toolCalls).toBeUndefined()
    expect(out[0]?.text).toBe('just thinking')
  })
})
