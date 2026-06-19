// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import * as realOpenAICompatible from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { LlmOrchestratorDeps } from '../../src/llm-orchestrator-types.js'
import { processMessage } from '../../src/llm-orchestrator.js'
import { runRegistry } from '../../src/run-control/registry.js'
import { setSystemConfig } from '../../src/system-config.js'
import {
  createMockReply,
  mockLogger,
  resetSystemConfigCacheForTesting,
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

// buildOpenAI must return a value typed as ReturnType<typeof createOpenAICompatible>.
// Using the real factory (no HTTP calls happen because generateText is stubbed).
const buildMockOpenAI: LlmOrchestratorDeps['buildOpenAI'] = (apiKey: string, baseURL: string) =>
  realOpenAICompatible.createOpenAICompatible({ name: 'mock-openai', apiKey, baseURL })

const seedSystemLlmConfig = (): void => {
  setSystemConfig('llm_apikey', 'test-key', 'env')
  setSystemConfig('llm_baseurl', 'http://localhost:11434', 'env')
  setSystemConfig('main_model', 'test-model', 'env')
}

describe('processMessage run lifecycle', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    resetSystemConfigCacheForTesting()
    seedSystemLlmConfig()
    runRegistry.clear()
  })
  afterEach(() => runRegistry.clear())

  test('the run is registered during the turn and removed after (every exit path cleans up)', async () => {
    const { reply } = createMockReply()
    let sawRunDuringTurn = false

    const deps: LlmOrchestratorDeps = {
      generateText: () => {
        sawRunDuringTurn = runRegistry.get('dm-user-1') !== undefined
        return Promise.resolve(okResult)
      },
      stepCountIs: (...args) => stepCountIs(...args),
      buildOpenAI: buildMockOpenAI,
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
      buildOpenAI: buildMockOpenAI,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }

    // handleLlmTurnError swallows the error and replies with a user-facing message;
    // processMessage itself does not rethrow.
    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hello', 'dm', undefined, deps, [], 't2')

    expect(runRegistry.get('dm-user-1')).toBeUndefined()
  })
})
