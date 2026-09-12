// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { generateText, stepCountIs } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import { setConfigValue } from '../../src/config.js'
import type { LlmOrchestratorDeps } from '../../src/llm-orchestrator-types.js'
import { processMessage } from '../../src/llm-orchestrator.js'
import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'
import { runRegistry } from '../../src/run-control/registry.js'
import {
  createMockReply,
  mockLogger,
  seedAdminLlmBinding,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from '../utils/test-helpers.js'

// A bare mock model: invokeModel passes it straight through and the stubbed
// generateText never actually drives it.
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

// A real, fully-typed generateText result so deps stays assignable to
// LlmOrchestratorDeps without any unsafe assertion.
type GenerateResult = Awaited<ReturnType<LlmOrchestratorDeps['generateText']>>
const okResult: GenerateResult = await generateText({ model: mockModel, prompt: 'hi' })

// Flip the live run's stop flag from the generateText seam, exactly like a
// concurrent /stop would mid-turn. Helper keeps the branch out of the test body.
function requestGracefulStop(contextId: string): void {
  const run = runRegistry.get(contextId)
  if (run !== undefined) run.stopRequested = true
}

describe('processMessage run lifecycle', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    seedAdminLlmBinding()
    runRegistry.clear()
    lastTurnRegistry.clear()
  })
  afterEach(() => {
    runRegistry.clear()
    lastTurnRegistry.clear()
  })

  test('the run is registered during the turn and removed after (every exit path cleans up)', async () => {
    const { reply } = createMockReply()
    let sawRunDuringTurn = false

    const deps: LlmOrchestratorDeps = {
      generateText: () => {
        sawRunDuringTurn = runRegistry.get('dm-user-1') !== undefined
        return Promise.resolve(okResult)
      },
      stepCountIs: (...args) => stepCountIs(...args),
      buildModel: () => mockModel,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }

    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps, [], 't1')

    expect(sawRunDuringTurn).toBe(true)
    expect(runRegistry.get('dm-user-1')).toBeUndefined()
  })

  test('run is cleaned up when generateText throws (error-path cleanup)', async () => {
    const { reply } = createMockReply()

    const deps: LlmOrchestratorDeps = {
      generateText: () => {
        return Promise.reject(new Error('boom'))
      },
      stepCountIs: (...args) => stepCountIs(...args),
      buildModel: () => mockModel,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }

    // handleLlmTurnError swallows the error and replies with a user-facing message;
    // processMessage itself does not rethrow.
    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps, [], 't2')

    expect(runRegistry.get('dm-user-1')).toBeUndefined()
  })

  test('graceful-stop summary is posted in the context language', async () => {
    setConfigValue('dm-user-1', 'language', 'ru')
    const { reply, getReplies } = createMockReply()

    const deps: LlmOrchestratorDeps = {
      generateText: () => {
        requestGracefulStop('dm-user-1')
        return Promise.resolve(okResult)
      },
      stepCountIs: (...args) => stepCountIs(...args),
      buildModel: () => mockModel,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }

    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps, [], 't4')

    expect(getReplies().some((text) => text.startsWith('🛑 Остановлено.'))).toBe(true)
  })

  test('records the last turn even when the catch body throws', async () => {
    const { reply } = createMockReply()
    // Drive the double-failure path: callLlm rejects (try block throws), then the
    // catch body's handleLlmTurnError -> handleOrchestratorMessageError -> reply.text
    // also rejects, simulating a transport failure on the user-facing error reply.
    reply.text = (): Promise<void> => Promise.reject(new Error('transport down'))

    const deps: LlmOrchestratorDeps = {
      generateText: () => Promise.reject(new Error('boom')),
      stepCountIs: (...args) => stepCountIs(...args),
      buildModel: () => mockModel,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }

    // The catch-body rejection propagates after finally runs; processMessage rethrows.
    await expect(
      processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps, [], 't3', 'member', [
        'orig-1',
      ]),
    ).rejects.toThrow('transport down')

    // Despite the catch body throwing, the finished turn was captured inside finally.
    const last = lastTurnRegistry.get('dm-user-1')
    expect(last).toBeDefined()
    expect(last?.originatingMessageIds).toEqual(['orig-1'])
  })
})
