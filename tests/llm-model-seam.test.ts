// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { generateText, stepCountIs } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import type { LlmOrchestratorDeps } from '../src/llm-orchestrator-types.js'
import { processMessage } from '../src/llm-orchestrator.js'
import { setSystemConfig } from '../src/system-config.js'
import {
  createMockReply,
  mockLogger,
  resetSystemConfigCacheForTesting,
  seedCommonTestPlatformInstances,
  setupTestDb,
} from './utils/test-helpers.js'

const model = new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: 'text', text: 'hello' }],
    finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 0, text: 0, reasoning: 0 },
    },
    warnings: [],
  },
})

describe('LLM model injection seam', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    seedCommonTestPlatformInstances()
    resetSystemConfigCacheForTesting()
    setSystemConfig('llm_apikey', 'test-key', 'env')
    setSystemConfig('llm_baseurl', 'https://llm.invalid/v1', 'env')
    setSystemConfig('main_model', 'test-model', 'env')
  })

  test('passes the model built from effective config to generateText unchanged', async () => {
    let receivedModel: unknown
    const deps: LlmOrchestratorDeps = {
      generateText: (options) => {
        receivedModel = options.model
        return generateText(options)
      },
      stepCountIs,
      buildModel: () => model,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    }
    const { reply, textCalls } = createMockReply()

    await processMessage(reply, 'dm-user-1', 'user-1', null, 'hi', 'dm', undefined, deps)

    expect(receivedModel).toBe(model)
    expect(textCalls).toContain('hello')
  })
})
