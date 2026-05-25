// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { AiOutputSettings } from '../src/ai-output-settings.js'
import { createAiProgressReporter } from '../src/ai-progress-reporter.js'
import { createMockReply } from './utils/test-helpers.js'

const hiddenSettings: AiOutputSettings = {
  toolVisibility: 'off',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
}

const toolSettings: AiOutputSettings = {
  toolVisibility: 'on',
  reasoningVisibility: 'off',
  detailLevel: 'sanitized',
}

describe('createAiProgressReporter', () => {
  test('does not emit anything when all visibility is off', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, hiddenSettings)

    reporter.toolStarted({ toolName: 'create_task', toolCallId: 'call-1', input: { title: 'x' } })
    reporter.toolFinished({
      toolName: 'create_task',
      toolCallId: 'call-1',
      input: { title: 'x' },
      durationMs: 10,
      success: true,
      output: { id: 'T-1' },
    })
    reporter.reasoning('Visible provider reasoning')
    await reporter.flush()

    expect(textCalls).toHaveLength(0)
  })

  test('flushes sanitized tool details without secrets', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, toolSettings)

    reporter.toolStarted({
      toolName: 'create_task',
      toolCallId: 'call-1',
      input: { title: 'Visible title', apiKey: 'secret-key' },
    })
    reporter.toolFinished({
      toolName: 'create_task',
      toolCallId: 'call-1',
      input: { title: 'Visible title', apiKey: 'secret-key' },
      durationMs: 42,
      success: true,
      output: { id: 'T-1', token: 'secret-token' },
    })
    await reporter.flush()

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('AI execution details')
    expect(textCalls[0]).toContain('create_task')
    expect(textCalls[0]).toContain('Visible title')
    expect(textCalls[0]).toContain('42ms')
    expect(textCalls[0]).not.toContain('secret-key')
    expect(textCalls[0]).not.toContain('secret-token')
    expect(textCalls[0]).toContain('[redacted]')
  })

  test('flushes sanitized circular objects and arrays with a safe marker', async () => {
    const { reply, textCalls } = createMockReply()
    const circularObject: Record<string, unknown> = { title: 'Circular title' }
    const circularArray: unknown[] = ['visible item']
    circularObject['self'] = circularObject
    circularArray[1] = circularArray
    const reporter = createAiProgressReporter(reply, toolSettings)

    reporter.toolFinished({
      toolName: 'create_task',
      toolCallId: 'call-circular',
      input: { title: 'Visible title', circularObject, circularArray },
      durationMs: 12,
      success: true,
    })
    await reporter.flush()

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Visible title')
    expect(textCalls[0]).toContain('Circular title')
    expect(textCalls[0]).toContain('visible item')
    expect(textCalls[0]).toContain('[circular]')
  })

  test('redacts sanitized URL and attachment content fields while preserving normal text', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, toolSettings)

    reporter.toolFinished({
      toolName: 'upload_attachment',
      toolCallId: 'call-redact-content',
      input: {
        title: 'Visible title',
        query: 'Visible query',
        url: 'https://example.invalid/private?token=secret',
        rawUrl: 'https://example.invalid/raw',
        attachment: { filename: 'private.txt' },
        fileContent: 'private file bytes',
        content: 'private body text',
      },
      durationMs: 15,
      success: true,
      output: { attachments: [{ id: 'file-1', content: 'private output text' }] },
    })
    await reporter.flush()

    expect(textCalls[0]).toContain('Visible title')
    expect(textCalls[0]).toContain('Visible query')
    expect(textCalls[0]).not.toContain('example.invalid')
    expect(textCalls[0]).not.toContain('private.txt')
    expect(textCalls[0]).not.toContain('private file bytes')
    expect(textCalls[0]).not.toContain('private body text')
    expect(textCalls[0]).not.toContain('private output text')
    expect(textCalls[0]).toContain('[redacted]')
  })

  test('raw detail level includes raw tool input and output', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'on',
      reasoningVisibility: 'off',
      detailLevel: 'raw',
    })

    reporter.toolFinished({
      toolName: 'search_tasks',
      toolCallId: 'call-2',
      input: { query: 'secret query' },
      durationMs: 7,
      success: true,
      output: { result: 'secret result' },
    })
    await reporter.flush()

    expect(textCalls[0]).toContain('secret query')
    expect(textCalls[0]).toContain('secret result')
  })

  test('emits provider reasoning only when reasoning visibility is on', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'sanitized',
    })

    reporter.reasoning('Provider exposed reasoning text')
    await reporter.flush()

    expect(textCalls).toHaveLength(1)
    expect(textCalls[0]).toContain('Reasoning')
    expect(textCalls[0]).toContain('Provider exposed reasoning text')
  })

  test('raw detail level uses raw provider reasoning when supplied', async () => {
    const { reply, textCalls } = createMockReply()
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'raw',
    })

    reporter.reasoning('Provider reasoning text', [{ type: 'reasoning', text: 'raw reasoning payload' }])
    await reporter.flush()

    expect(textCalls[0]).toContain('raw reasoning payload')
  })

  test('does not emit an empty reasoning section', async () => {
    const { reply, textCalls } = createMockReply()
    const emptyReasoning: string | undefined = undefined
    const reporter = createAiProgressReporter(reply, {
      toolVisibility: 'off',
      reasoningVisibility: 'on',
      detailLevel: 'sanitized',
    })

    reporter.reasoning(emptyReasoning)
    reporter.reasoning('')
    await reporter.flush()

    expect(textCalls).toHaveLength(0)
  })
})
