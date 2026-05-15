// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { renderTraceDetail } from '../../../client/debug/trace-detail.js'
import type { LlmTrace } from '../../../src/debug/schemas.js'

type ModalElements = Parameters<typeof renderTraceDetail>[1]

function makeMockElements(): ModalElements {
  return {
    $traceModal: document.createElement('div'),
    $traceModalTitle: document.createElement('h3'),
    $traceModalBody: document.createElement('div'),
    $traceModalClose: document.createElement('button'),
  }
}

function baseTrace(stepsDetail: LlmTrace['stepsDetail']): LlmTrace {
  return {
    timestamp: Date.now(),
    userId: 'user-123',
    model: 'gpt-4',
    duration: 1000,
    steps: stepsDetail?.length ?? 0,
    totalTokens: { inputTokens: 50, outputTokens: 30 },
    stepsDetail,
  }
}

describe('trace-detail types', () => {
  test('LlmTrace type accepts all expected fields', () => {
    const trace: LlmTrace = {
      timestamp: Date.now(),
      userId: 'user-123',
      model: 'gpt-4',
      duration: 2500,
      steps: 3,
      totalTokens: { inputTokens: 150, outputTokens: 250 },
      toolCalls: [
        {
          toolName: 'create_task',
          durationMs: 500,
          success: true,
          toolCallId: 'call-1',
          args: { title: 'Test' },
          result: { id: 'task-123' },
        },
      ],
      responseId: 'resp-123',
      actualModel: 'gpt-4-0125-preview',
      finishReason: 'stop',
      messageCount: 5,
      toolCount: 10,
      generatedText: 'Hello!',
      stepsDetail: [
        {
          stepNumber: 1,
          toolCalls: [{ toolName: 'search', toolCallId: 'call-1', args: {} }],
          usage: { inputTokens: 50, outputTokens: 30 },
        },
      ],
    }

    expect(trace.model).toBe('gpt-4')
    expect(trace.toolCalls).toHaveLength(1)
    expect(trace.stepsDetail).toHaveLength(1)
    expect(trace.generatedText).toBe('Hello!')
  })
})

describe('renderTraceDetail steps detail rendering', () => {
  test('renders step text when present', () => {
    const elements = makeMockElements()
    renderTraceDetail(
      baseTrace([
        {
          stepNumber: 1,
          text: 'Thinking about which tool to call...',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
      elements,
    )
    const body = elements.$traceModalBody.innerHTML
    expect(body).toContain('Thinking about which tool to call...')
  })

  test('renders finish reason when present', () => {
    const elements = makeMockElements()
    renderTraceDetail(
      baseTrace([
        {
          stepNumber: 1,
          finishReason: 'tool-calls',
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      ]),
      elements,
    )
    const body = elements.$traceModalBody.innerHTML
    expect(body).toContain('tool-calls')
  })

  test('renders tool result inline with tool call in the step view', () => {
    const elements = makeMockElements()
    renderTraceDetail(
      baseTrace([
        {
          stepNumber: 1,
          toolCalls: [
            {
              toolName: 'search',
              toolCallId: 'call-1',
              args: { query: 'foo' },
              result: { hits: 7 },
            },
          ],
        },
      ]),
      elements,
    )
    const body = elements.$traceModalBody.innerHTML
    expect(body).toContain('"hits"')
    expect(body).toContain('7')
  })

  test('renders tool error inline with tool call in the step view', () => {
    const elements = makeMockElements()
    renderTraceDetail(
      baseTrace([
        {
          stepNumber: 1,
          toolCalls: [
            {
              toolName: 'create_task',
              toolCallId: 'call-1',
              args: { title: 'x' },
              error: 'permission denied',
            },
          ],
        },
      ]),
      elements,
    )
    const body = elements.$traceModalBody.innerHTML
    expect(body).toContain('permission denied')
    expect(body).toContain('step-tool-error')
  })
})
