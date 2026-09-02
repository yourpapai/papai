// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, isStepCount, type LanguageModel } from 'ai'

import { runWithProviderRequestScope } from '../analytics/provider-request-scope.js'
import type { ProviderRequestScope } from '../analytics/provider-request-scope.js'
import { resolveProactiveProviderRequestScope } from '../analytics/provider-scope-factory.js'
import type { ProactiveScopeInput } from '../analytics/provider-scope-factory.js'
import { getCachedHistory } from '../cache.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { hoistSystemMessages } from '../llm-message-utils.js'
import { buildChatModel } from '../llm-model-builder.js'
import { emitLlmEnd, emitLlmStart } from '../llm-orchestrator-events.js'
import { emitLlmError } from '../llm-orchestrator-logging.js'
import { collectTurnMessages } from '../llm-orchestrator-messages.js'
import { handleToolCallFinish } from '../llm-orchestrator-support.js'
import { adaptToolExecutionEnd } from '../llm-orchestrator-tool-events.js'
import { logger } from '../logger.js'
import { createDisclosurePrepareStep } from '../tools/disclosure/prepare-step.js'
import { buildToolsContextRecord } from '../tools/wrap-tool-execution.js'
import { getContextLanguage } from '../utils/config-language.js'
import { getLlmConfig, type LlmConfig } from './proactive-llm-config.js'
import { buildFullMessages, buildFullToolSet } from './proactive-llm-full.js'
import {
  buildFullSystemPrompt,
  buildProactiveVerification,
  finalizeAndLog,
  getConfigContextId,
  getStorageContextId,
  resolveFullProvider,
  type BuildProviderFn,
  type FullGenerationInput,
  type ProactiveLlmDispatchArgs,
} from './proactive-llm-helpers.js'
import { persistProactiveResults } from './proactive-llm-persist.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

export type DeferredExecutionContext = {
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}

export interface ProactiveLlmDeps {
  generateText: typeof generateText
  stepCountIs: typeof isStepCount
  buildModel: (config: { apiKey: string; baseURL: string }, modelId: string) => LanguageModel
  /** Scope factory seam: production resolves from the active analytics runtime; tests inject fakes. */
  resolveScope?: (input: ProactiveScopeInput) => ProviderRequestScope
}

const defaultProactiveLlmDeps: ProactiveLlmDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => isStepCount(...args),
  buildModel: (config, modelId) => buildChatModel(config.apiKey, config.baseURL, modelId),
}
type DispatchExecutionArgs = ProactiveLlmDispatchArgs<Partial<ProactiveLlmDeps>, BuildProviderFn>
export type { BuildProviderFn }

const resolveDeps = (deps: Partial<ProactiveLlmDeps> | undefined): ProactiveLlmDeps => ({
  ...defaultProactiveLlmDeps,
  ...deps,
})

async function prepareFullGenerationInput(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  matchedTasksSummary: string | undefined,
  provider: Awaited<ReturnType<BuildProviderFn>>,
): Promise<FullGenerationInput> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  const { tools, enabledToolNames, disclosure } = await buildFullToolSet(
    provider,
    createdByUserId,
    storageContextId,
    deliveryTarget.contextType,
    prompt,
  )
  const systemPrompt = buildFullSystemPrompt(provider, storageContextId, enabledToolNames)
  const { messages } = buildFullMessages(
    createdByUserId,
    storageContextId,
    type,
    prompt,
    matchedTasksSummary,
    metadata,
    deliveryTarget.contextType,
  )
  return { storageContextId, tools, systemPrompt, messages, disclosure }
}

type ScopedGenerationArgs = Readonly<{
  execCtx: DeferredExecutionContext
  type: 'scheduled' | 'alert'
  prompt: string
  metadata: ExecutionMetadata
  matchedTasksSummary: string | undefined
  config: LlmConfig
  configContextId: string
  provider: Awaited<ReturnType<BuildProviderFn>>
  deps: ProactiveLlmDeps
  model: LanguageModel
  scope: Parameters<typeof runWithProviderRequestScope>[0]
}>

/**
 * Debug-trace emission parity with invokeModel (llm:start/end/error): the proof
 * checks correlate the run's own trace from recentLlm, so the proactive execution
 * must land one. chatUserId is the delivery target's context id — the prompt
 * owner's native chat user id for DM targets (admin/DM storage contexts are
 * user-keyed), which is what findOwnTrace attributes against.
 */
const generateWithTrace = async (
  execCtx: DeferredExecutionContext,
  config: LlmConfig,
  prepared: FullGenerationInput,
  deps: ProactiveLlmDeps,
  scope: Parameters<typeof runWithProviderRequestScope>[0],
  turnId: string,
  baseOptions: Parameters<ProactiveLlmDeps['generateText']>[0],
): Promise<Awaited<ReturnType<ProactiveLlmDeps['generateText']>>> => {
  const start = Date.now()
  emitLlmStart(prepared.storageContextId, config.mainModel, prepared.messages, prepared.tools, turnId)
  try {
    const result = await deps.generateText(
      Object.assign({}, baseOptions, { toolsContext: buildToolsContextRecord(prepared.tools, scope) }),
    )
    emitLlmEnd(
      prepared.storageContextId,
      execCtx.deliveryTarget.contextId,
      execCtx.deliveryTarget.contextType,
      config.mainModel,
      result,
      start,
      prepared.messages,
      prepared.tools,
      turnId,
    )
    return result
  } catch (error) {
    emitLlmError(
      prepared.storageContextId,
      execCtx.deliveryTarget.contextId,
      execCtx.deliveryTarget.contextType,
      config.mainModel,
      start,
      prepared.messages.length,
      error,
      turnId,
    )
    throw error
  }
}

const runScopedGeneration = async (args: ScopedGenerationArgs): Promise<string> => {
  const { execCtx, config, configContextId, deps, model, scope } = args
  const { createdByUserId } = execCtx
  const prepared = await prepareFullGenerationInput(
    execCtx,
    args.type,
    args.prompt,
    args.metadata,
    args.matchedTasksSummary,
    args.provider,
  )
  const tools = prepared.tools
  const turnId = `proactive:${prepared.storageContextId}:${String(Date.now())}`
  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: prepared.messages.length },
    'generateText',
  )
  // Keyed toolsContext record: every name in the final ToolSet maps to the
  // same immutable scope (see llm-orchestrator-invoke.ts for the Object.assign
  // intersection rationale).
  const baseOptions: Parameters<ProactiveLlmDeps['generateText']>[0] = {
    model,
    ...hoistSystemMessages(prepared.systemPrompt, prepared.messages),
    tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
    prepareStep: createDisclosurePrepareStep(prepared.disclosure, prepared.storageContextId, turnId),
    onToolExecutionEnd: (event) => {
      handleToolCallFinish(prepared.storageContextId, undefined, { ...adaptToolExecutionEnd(event), turnId })
    },
  }
  const result = await generateWithTrace(execCtx, config, prepared, deps, scope, turnId, baseOptions)
  const previousHistory = getCachedHistory(prepared.storageContextId)
  const assistantMessages = collectTurnMessages(result)
  persistProactiveResults(
    createdByUserId,
    prepared.storageContextId,
    configContextId,
    execCtx.deliveryTarget.contextType,
    result,
    previousHistory,
    config.mainModel,
  )
  return finalizeAndLog(
    result,
    createdByUserId,
    buildProactiveVerification(deps, model, tools, [...prepared.messages, ...assistantMessages], scope),
    getContextLanguage(configContextId),
  )
}

function runFullGeneration(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  matchedTasksSummary: string | undefined,
  config: LlmConfig,
  configContextId: string,
  provider: Awaited<ReturnType<BuildProviderFn>>,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId } = execCtx
  const model = deps.buildModel(config, config.mainModel)
  // One independent immutable proactive scope per execution, established before
  // descriptor construction. Never reuses a normal-turn or prior-owner scope.
  const scope = (deps.resolveScope ?? resolveProactiveProviderRequestScope)({
    createdByUserId,
    deliveryTarget: execCtx.deliveryTarget,
  })
  return runWithProviderRequestScope(scope, () =>
    runScopedGeneration({
      execCtx,
      type,
      prompt,
      metadata,
      matchedTasksSummary,
      config,
      configContextId,
      provider,
      deps,
      model,
      scope,
    }),
  )
}

async function invokeFull(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  buildProviderFn: BuildProviderFn,
  matchedTasksSummary: string | undefined,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  const configContextId = getConfigContextId(execCtx)
  log.debug({ userId: createdByUserId }, 'invokeFull called')
  const config = getLlmConfig(configContextId)
  if (typeof config === 'string') return config

  const provider = await resolveFullProvider(buildProviderFn, createdByUserId, storageContextId, configContextId)
  return runFullGeneration(
    execCtx,
    type,
    prompt,
    metadata,
    matchedTasksSummary,
    config,
    configContextId,
    provider,
    deps,
  )
}

export function dispatchExecution(...args: DispatchExecutionArgs): Promise<string> {
  const [execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, deps] = args
  const { createdByUserId } = execCtx
  const resolvedDeps = resolveDeps(deps)
  log.debug({ userId: createdByUserId }, 'dispatchExecution called')
  return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, resolvedDeps)
}
