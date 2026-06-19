// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { OnToolCallFinishEvent, PrepareStepResult } from 'ai'

import { invokeModel } from '../../src/llm-orchestrator-invoke.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from '../../src/llm-orchestrator-types.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { RunAbortedError } from '../../src/run-control/types.js'
import { createMockReply, mockLogger } from '../utils/test-helpers.js'

type CapturedOpts = Parameters<LlmOrchestratorDeps['generateText']>[0]

type OkResult = {
  text: string
  toolCalls: []
  toolResults: []
  steps: []
  response: { messages: [] }
}

const okResult: OkResult = { text: 'done', toolCalls: [], toolResults: [], steps: [], response: { messages: [] } }

function buildArgs(
  captured: { opts?: CapturedOpts },
  generateText: (opts: CapturedOpts) => Promise<OkResult>,
): InvokeModelArgs & { reply: undefined; turnId: string } {
  return {
    contextId: 'ctx-1',
    chatUserId: 'user-1',
    contextType: 'dm',
    mainModel: 'main',
    // @ts-expect-error - minimal model stub; not called by fake generateText
    model: {},
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user' as const, content: 'hi' }],
    deps: {
      // @ts-expect-error - concrete function assigned to generic generateText type; captures opts for test
      generateText: (opts: CapturedOpts) => {
        captured.opts = opts
        return generateText(opts)
      },
      // @ts-expect-error - plain object returned as StopCondition for test toEqual assertions
      stepCountIs: (n: number) => ({ kind: 'stepCount', n }),
      // @ts-expect-error - buildOpenAI stub; not called in these tests
      buildOpenAI: () => ({}),
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    },
    reply: undefined,
    turnId: 't1',
  }
}

function makeFinishEvent(toolName: string): OnToolCallFinishEvent {
  return {
    toolCall: { type: 'tool-call', toolName, toolCallId: 'c1', input: {}, dynamic: true },
    output: {},
    success: true,
    durationMs: 0,
    stepNumber: undefined,
    model: undefined,
    messages: [],
    abortSignal: undefined,
    functionId: undefined,
    metadata: undefined,
    experimental_context: undefined,
  }
}

describe('invokeModel run-control wiring', () => {
  beforeEach(() => {
    mockLogger()
    runRegistry.clear()
  })
  afterEach(() => {
    runRegistry.clear()
  })

  test('no active run: stopWhen is the bare stepCount, no abortSignal, no steering prepareStep', async () => {
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))
    expect(captured.opts?.stopWhen as unknown).toEqual({ kind: 'stepCount', n: 25 })
    expect(captured.opts?.abortSignal).toBeUndefined()
    expect(captured.opts?.prepareStep).toBeUndefined()
  })

  test('active run: stopWhen is an array including a live stop condition; abortSignal present', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const sw = captured.opts?.stopWhen
    assert.ok(Array.isArray(sw), 'stopWhen should be an array')
    expect(sw[0] as unknown).toEqual({ kind: 'stepCount', n: 25 })
    const liveCondition = sw[1]
    assert.ok(liveCondition !== undefined, 'stopWhen[1] should be the live stop condition')
    expect(liveCondition({ steps: [] })).toBe(false)
    run.stopRequested = true
    expect(liveCondition({ steps: [] })).toBe(true)

    expect(captured.opts?.abortSignal).toBe(run.abortController.signal)
  })

  test('active run: prepareStep injects queued steer messages', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    run.steerQueue.push({ text: 'only project X' })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const prepareStepFn = captured.opts?.prepareStep
    assert.ok(prepareStepFn !== undefined, 'prepareStep should be defined')
    // @ts-expect-error - steering step is sync; PromiseLike branch not taken
    const result: PrepareStepResult = prepareStepFn({
      stepNumber: 1,
      steps: [],
      messages: [{ role: 'user' as const, content: 'a' }],
      model: 'stub',
      experimental_context: undefined,
    })
    expect(result?.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'only project X' },
    ])
  })

  test('active run: onToolCallFinish records completed effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const onFinish = captured.opts?.experimental_onToolCallFinish
    assert.ok(onFinish !== undefined, 'experimental_onToolCallFinish should be defined')
    onFinish(makeFinishEvent('update_task'))
    expect(run.completedEffects).toEqual([{ toolName: 'update_task' }])
  })

  test('force-abort: aborted signal turns AbortError into RunAbortedError carrying effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply })
    run.completedEffects.push({ toolName: 'update_task' })
    const captured: { opts?: CapturedOpts } = {}

    const args = buildArgs(captured, () => {
      run.abortController.abort()
      const err = new Error('Aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    await expect(invokeModel(args)).rejects.toBeInstanceOf(RunAbortedError)
  })

  test('non-abort errors pass through unchanged', async () => {
    runRegistry.begin('ctx-1', { turnId: 't1', reply: createMockReply().reply })
    const captured: { opts?: CapturedOpts } = {}
    const args = buildArgs(captured, () => Promise.reject(new Error('boom')))
    await expect(invokeModel(args)).rejects.toThrow('boom')
  })
})
