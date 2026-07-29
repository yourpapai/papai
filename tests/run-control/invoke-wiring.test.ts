// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import { generateText, stepCountIs } from 'ai'
import type { ToolExecutionEndEvent } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import { invokeModel } from '../../src/llm-orchestrator-invoke.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from '../../src/llm-orchestrator-types.js'
import { defaultDeps } from '../../src/llm-orchestrator.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { RunAbortedError } from '../../src/run-control/types.js'
import { createMockReply, mockLogger, setupTestDb } from '../utils/test-helpers.js'

type CapturedOpts = Parameters<LlmOrchestratorDeps['generateText']>[0]
type GenerateResult = Awaited<ReturnType<LlmOrchestratorDeps['generateText']>>

// A bare mock model is enough: invokeModel passes it straight through and the
// stubbed generateText never actually drives it.
const mockModel = new MockLanguageModelV3({
  doGenerate: {
    content: [],
    finishReason: { unified: 'stop', raw: undefined } as const,
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  },
})

// A real, fully-typed result reused as the canned success return so the mock
// deps stay assignable to LlmOrchestratorDeps without an unsafe assertion.
const okResult: GenerateResult = await generateText({ model: mockModel, prompt: 'hi' })

// Records the stepCount limits invokeModel asks for, while returning a real
// StopCondition so deps.stepCountIs keeps its production type.
const stepCountArgs: number[] = []
const spyStepCountIs: LlmOrchestratorDeps['stepCountIs'] = (n) => {
  stepCountArgs.push(n)
  return stepCountIs(n)
}

function buildArgs(
  captured: { opts?: CapturedOpts },
  generateTextImpl: () => Promise<GenerateResult>,
): InvokeModelArgs & { reply: undefined; turnId: string } {
  return {
    contextId: 'ctx-1',
    configId: 'ctx-1',
    chatUserId: 'user-1',
    contextType: 'dm',
    mainModel: 'main',
    model: mockModel,
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user' as const, content: 'hi' }],
    deps: {
      ...defaultDeps,
      generateText: (opts) => {
        captured.opts = opts
        return generateTextImpl()
      },
      stepCountIs: spyStepCountIs,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    },
    reply: undefined,
    turnId: 't1',
  }
}

function makeFinishEvent(toolName: string): ToolExecutionEndEvent {
  return {
    callId: 'call-1',
    toolExecutionMs: 0,
    messages: [],
    toolCall: { type: 'tool-call', toolName, toolCallId: 'c1', input: {}, dynamic: true },
    toolContext: undefined,
    toolOutput: { type: 'tool-result', toolCallId: 'c1', toolName, input: {}, output: {}, dynamic: true },
  }
}

describe('invokeModel run-control wiring', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    runRegistry.clear()
    stepCountArgs.length = 0
  })
  afterEach(() => {
    runRegistry.clear()
  })

  test('no active run: stopWhen is an array with step cap + no-progress guard, no abortSignal, no steering prepareStep', async () => {
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))
    const sw = captured.opts?.stopWhen
    assert.ok(Array.isArray(sw), 'stopWhen should be an array')
    expect(sw).toHaveLength(2)
    expect(stepCountArgs).toEqual([50])
    // stopWhen[1] is the no-progress guard (behavior covered by no-progress-condition.test.ts).
    assert.ok(typeof sw[1] === 'function', 'stopWhen[1] should be the no-progress condition')
    // A start-of-turn call (empty steps) must never stop the loop.
    expect(sw[1]({ steps: [] })).toBe(false)
    expect(captured.opts?.abortSignal).toBeUndefined()
    expect(captured.opts?.prepareStep).toBeUndefined()
  })

  test('active run: stopWhen includes step cap, no-progress guard, and a live stop condition; abortSignal present', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const sw = captured.opts?.stopWhen
    assert.ok(Array.isArray(sw), 'stopWhen should be an array')
    expect(sw).toHaveLength(3)
    expect(stepCountArgs).toEqual([50])
    const liveCondition = sw[2]
    assert.ok(liveCondition !== undefined, 'stopWhen[2] should be the live stop condition')
    expect(liveCondition({ steps: [] })).toBe(false)
    run.stopRequested = true
    expect(liveCondition({ steps: [] })).toBe(true)

    expect(captured.opts?.abortSignal).toBe(run.abortController.signal)
  })

  test('active run: prepareStep injects queued steer messages', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    run.steerQueue.push({ text: 'only project X' })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const prepareStepFn = captured.opts?.prepareStep
    assert.ok(prepareStepFn !== undefined, 'prepareStep should be defined')
    const result = await prepareStepFn({
      stepNumber: 1,
      steps: [],
      messages: [{ role: 'user' as const, content: 'a' }],
      model: mockModel,
      instructions: undefined,
      initialInstructions: undefined,
      initialMessages: [],
      responseMessages: [],
      toolsContext: {},
      runtimeContext: {},
    })
    expect(result?.messages).toEqual([
      { role: 'user', content: 'a' },
      { role: 'user', content: 'only project X' },
    ])
  })

  test('active run: onToolCallFinish records completed effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, () => Promise.resolve(okResult)))

    const onFinish = captured.opts?.onToolExecutionEnd
    assert.ok(onFinish !== undefined, 'onToolExecutionEnd should be defined')
    onFinish(makeFinishEvent('update_task'))
    expect(run.completedEffects).toEqual([{ toolName: 'update_task' }])
  })

  test('force-abort: aborted signal turns AbortError into RunAbortedError carrying effects', async () => {
    const { reply } = createMockReply()
    const run = runRegistry.begin('ctx-1', { turnId: 't1', reply, originatingMessageIds: [] })
    run.completedEffects.push({ toolName: 'update_task' })
    const captured: { opts?: CapturedOpts } = {}

    const args = buildArgs(captured, () => {
      run.abortController.abort()
      const err = new Error('Aborted')
      err.name = 'AbortError'
      return Promise.reject(err)
    })

    const err: unknown = await invokeModel(args).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RunAbortedError)
    assert.ok(err instanceof RunAbortedError)
    expect(err.effects).toEqual([{ toolName: 'update_task' }])
  })

  test('non-abort errors pass through unchanged', async () => {
    runRegistry.begin('ctx-1', { turnId: 't1', reply: createMockReply().reply, originatingMessageIds: [] })
    const captured: { opts?: CapturedOpts } = {}
    const args = buildArgs(captured, () => Promise.reject(new Error('boom')))
    await expect(invokeModel(args)).rejects.toThrow('boom')
  })
})
