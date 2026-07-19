// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText, stepCountIs, type LanguageModel } from 'ai'

import { getCachedHistory } from '../cache.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'
import { createDisclosurePrepareStep } from '../tools/disclosure/prepare-step.js'
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
  stepCountIs: typeof stepCountIs
  buildModel: (config: { apiKey: string; baseURL: string }, modelId: string) => LanguageModel
}

const defaultProactiveLlmDeps: ProactiveLlmDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildModel: (config, modelId) => buildChatModel(config.apiKey, config.baseURL, modelId),
}
type DispatchExecutionArgs = ProactiveLlmDispatchArgs<ProactiveLlmDeps, BuildProviderFn>
export type { BuildProviderFn }

const resolveDeps = (deps: ProactiveLlmDeps | undefined): ProactiveLlmDeps => deps ?? defaultProactiveLlmDeps

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

async function runFullGeneration(
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
  const prepared = await prepareFullGenerationInput(execCtx, type, prompt, metadata, matchedTasksSummary, provider)
  const turnId = `proactive:${prepared.storageContextId}:${String(Date.now())}`
  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: prepared.messages.length },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: prepared.systemPrompt,
    messages: prepared.messages,
    tools: prepared.tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
    prepareStep: createDisclosurePrepareStep(prepared.disclosure, prepared.storageContextId, turnId),
  })
  const previousHistory = getCachedHistory(prepared.storageContextId)
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
    'full',
    buildProactiveVerification(deps, model, prepared.tools, [...prepared.messages, ...result.response.messages]),
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
  log.debug({ userId: createdByUserId, mode: 'full' }, 'invokeFull called')
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
