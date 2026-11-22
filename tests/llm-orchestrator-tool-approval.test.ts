// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { generateText, stepCountIs, type ToolApprovalStatus } from 'ai'
import { MockLanguageModelV3 } from 'ai/test'

import { NO_ANALYTICS_SCOPE } from '../src/analytics/provider-request-scope.js'
import type { FullGenerationInput } from '../src/deferred-prompts/proactive-llm-helpers.js'
import { buildFullGenerationBaseOptions, type ProactiveLlmDeps } from '../src/deferred-prompts/proactive-llm.js'
import { invokeModel } from '../src/llm-orchestrator-invoke.js'
import { buildTurnVerifier } from '../src/llm-orchestrator-support.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from '../src/llm-orchestrator-types.js'
import { defaultDeps } from '../src/llm-orchestrator.js'
import { createDisclosureSession } from '../src/tools/disclosure/registry.js'
import { buildToolApproval, type ToolApprovalFn } from '../src/tools/permission-gate.js'
import { setToolPrefs } from '../src/tools/tool-preferences.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

type CapturedOpts = Parameters<LlmOrchestratorDeps['generateText']>[0]
type GenerateResult = Awaited<ReturnType<LlmOrchestratorDeps['generateText']>>

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

const okResult: GenerateResult = await generateText({ model: mockModel, prompt: 'hi' })

const notApplicable: ToolApprovalFn = () => Promise.resolve('not-applicable')

const deniedReason = (decision: ToolApprovalStatus): string =>
  typeof decision === 'object' && decision !== null && decision.type === 'denied' ? (decision.reason ?? '') : ''

function buildArgs(
  captured: { opts?: CapturedOpts },
  toolApproval: ToolApprovalFn,
): InvokeModelArgs & { reply: undefined; turnId: string } {
  return {
    contextId: 'ctx-1',
    chatUserId: 'user-1',
    contextType: 'dm',
    mainModel: 'main',
    model: mockModel,
    provider: null,
    tools: {},
    enabledToolNames: new Set<string>(),
    messages: [{ role: 'user' as const, content: 'hi' }],
    providerRequestScope: NO_ANALYTICS_SCOPE,
    toolApproval,
    deps: {
      ...defaultDeps,
      generateText: (opts) => {
        captured.opts = opts
        return Promise.resolve(okResult)
      },
      stepCountIs,
      resolve: () => null,
      maybeAutoProvision: () => Promise.resolve(false),
    },
    reply: undefined,
    turnId: 't1',
  }
}

const runtimeContext = {
  contextId: 'ctx-1',
  chatUserId: 'user-1',
  contextType: 'dm' as const,
  model: 'main',
  modelRole: 'main' as const,
  turnId: 't1',
}

describe('toolApproval wiring', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('the interactive model call receives the resolver and the turn runtime context', async () => {
    const captured: { opts?: CapturedOpts } = {}
    await invokeModel(buildArgs(captured, notApplicable))

    expect(captured.opts?.toolApproval).toBe(notApplicable)
    expect(captured.opts?.runtimeContext).toEqual(runtimeContext)
  })

  test('the verifier call receives the same resolver and its own runtime context', async () => {
    const captured: { opts?: CapturedOpts } = {}
    const args = buildArgs(captured, notApplicable)
    const verifier = buildTurnVerifier(args)

    await verifier.invokeVerifier({ system: 'verify', messages: [] })

    expect(captured.opts?.toolApproval).toBe(notApplicable)
    expect(captured.opts?.runtimeContext).toEqual(runtimeContext)
  })

  test('the proactive call receives a resolver that denies an ask tool without a chat surface', async () => {
    const pctx = 'proactive-approval-ctx'
    setToolPrefs(pctx, { riskDefaults: {}, domainDefaults: {}, toolOverrides: { delete_task: 'ask' } })
    const disclosure = createDisclosureSession({}, new Set())
    const prepared: FullGenerationInput = {
      storageContextId: pctx,
      tools: {},
      systemPrompt: 'proactive',
      messages: [],
      disclosure,
      toolApproval: buildToolApproval({ contextId: pctx, askPermission: undefined }),
    }
    const deps: ProactiveLlmDeps = {
      generateText: (...args) => generateText(...args),
      stepCountIs,
      buildModel: () => mockModel,
    }

    const opts = buildFullGenerationBaseOptions(prepared, deps, mockModel, 'proactive:turn-1')

    expect(opts.toolApproval).toBe(prepared.toolApproval)
    const resolver = prepared.toolApproval
    const decision = await resolver({
      toolCall: { toolName: 'delete_task', toolCallId: 'tc1', input: { id: 'T-1', _permission_reason: 'cleanup' } },
    })
    expect(decision).toMatchObject({ type: 'denied' })
    expect(deniedReason(decision)).toContain('no chat surface')
  })
})
