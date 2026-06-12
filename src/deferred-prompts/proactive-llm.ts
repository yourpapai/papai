// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { logger } from '../logger.js'
import { makeGetCurrentTimeTool } from '../tools/get-current-time.js'
import { buildFullMessages, buildFullToolSet } from './proactive-llm-full.js'
import {
  buildContextMessages,
  buildFullSystemPrompt,
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  getStorageContextId,
  modelIdForLightweight,
  persistContextResponse,
  persistLightweightResponse,
  persistProactiveResults,
  resultTextOrDone,
  resolveFullProvider,
  type BuildProviderFn,
  type ProactiveLlmDispatchArgs,
  wrapPrompt,
} from './proactive-llm-helpers.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

export type DeferredExecutionContext = {
  createdByUserId: string
  deliveryTarget: DeferredDeliveryTarget
}

const makeMinimalTools = (userId: string): { get_current_time: ReturnType<typeof makeGetCurrentTimeTool> } => ({
  get_current_time: makeGetCurrentTimeTool(userId),
})

export interface ProactiveLlmDeps {
  generateText: typeof generateText
  stepCountIs: typeof stepCountIs
  buildModel: (
    config: { apiKey: string; baseURL: string },
    modelId: string,
  ) => ReturnType<ReturnType<typeof createOpenAICompatible>>
}

const defaultProactiveLlmDeps: ProactiveLlmDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildModel: (config, modelId) => createOpenAICompatible({ name: 'openai-compatible', ...config })(modelId),
}
type LlmConfig = { apiKey: string; baseURL: string; mainModel: string; smallModel: string }
type DispatchExecutionArgs = ProactiveLlmDispatchArgs<ProactiveLlmDeps, BuildProviderFn>
export type { BuildProviderFn }
type FullGenerationInput = Readonly<{
  storageContextId: string
  tools: Awaited<ReturnType<typeof buildFullToolSet>>['tools']
  systemPrompt: string
  messages: ModelMessage[]
}>

function getLlmConfig(configContextId: string): LlmConfig | string {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) {
    log.warn(
      {
        configContextId,
        source: resolved.source,
        type: resolved.type,
        missing: resolved.type === 'missing' ? resolved.missing : undefined,
        error: resolved.type === 'error' ? resolved.error : undefined,
      },
      'Missing LLM config for deferred prompt',
    )
    if (resolved.source === 'global') {
      return 'Deferred prompt skipped: the bot is not fully configured. The administrator has been notified.'
    }
    if (resolved.type === 'missing') {
      return 'Deferred prompt skipped: BYOK is enabled for this context, but required LLM settings are missing. Use /config to complete setup.'
    }
    return 'Deferred prompt skipped: BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.'
  }
  return {
    apiKey: resolved.llmApiKey,
    baseURL: resolved.llmBaseUrl,
    mainModel: resolved.mainModel,
    smallModel: resolved.smallModel,
  }
}

const getConfigContextId = (execCtx: DeferredExecutionContext): string =>
  getConfigContextIdFromStorageContextId(getStorageContextId(execCtx.deliveryTarget))

const resolveDeps = (deps: ProactiveLlmDeps | undefined): ProactiveLlmDeps => {
  if (deps === undefined) return defaultProactiveLlmDeps
  return deps
}

async function invokeLightweight(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  const configContextId = getConfigContextId(execCtx)
  log.debug({ userId: createdByUserId, mode: 'lightweight' }, 'invokeLightweight called')
  const config = getLlmConfig(configContextId)
  if (typeof config === 'string') return config

  const modelId = modelIdForLightweight(config.smallModel, config.mainModel)
  const model = deps.buildModel(config, modelId)
  const messages: ModelMessage[] = [...buildMetadataMessages(metadata), { role: 'user', content: wrapPrompt(prompt) }]

  log.debug({ userId: createdByUserId, modelId, mode: 'lightweight' }, 'Calling generateText')
  const result = await deps.generateText({
    model,
    system: buildMinimalSystemPrompt(type),
    messages,
    tools: makeMinimalTools(createdByUserId),
    timeout: 1_200_000,
  })

  const assistantMessages = result.response.messages
  persistLightweightResponse(createdByUserId, storageContextId, configContextId, config.mainModel, assistantMessages)
  return resultTextOrDone(result.text)
}

async function invokeWithContext(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  const configContextId = getConfigContextId(execCtx)
  log.debug({ userId: createdByUserId, mode: 'context' }, 'invokeWithContext called')
  const config = getLlmConfig(configContextId)
  if (typeof config === 'string') return config

  const model = deps.buildModel(config, config.mainModel)
  const history = getCachedHistory(storageContextId)
  const messages = buildContextMessages(storageContextId, deliveryTarget.contextType, history, metadata, prompt)

  log.debug(
    {
      userId: createdByUserId,
      mainModel: config.mainModel,
      historyLength: history.length,
      mode: 'context',
    },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: buildMinimalSystemPrompt(type),
    messages,
    tools: makeMinimalTools(createdByUserId),
    timeout: 1_200_000,
  })

  persistContextResponse(
    storageContextId,
    configContextId,
    deliveryTarget.contextType,
    history,
    config.mainModel,
    result.response.messages,
  )
  return resultTextOrDone(result.text)
}

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
  const { tools, enabledToolNames } = await buildFullToolSet(
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
  return { storageContextId, tools, systemPrompt, messages }
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
  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: prepared.messages.length, mode: 'full' },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: prepared.systemPrompt,
    messages: prepared.messages,
    tools: prepared.tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
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
  return resultTextOrDone(result.text)
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
  const configContextId = getConfigContextIdFromStorageContextId(storageContextId)
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
  log.debug({ userId: createdByUserId, mode: metadata.mode }, 'dispatchExecution called')
  switch (metadata.mode) {
    case 'lightweight':
      return invokeLightweight(execCtx, type, prompt, metadata, resolvedDeps)
    case 'context':
      return invokeWithContext(execCtx, type, prompt, metadata, resolvedDeps)
    case 'full':
      return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, resolvedDeps)
    default:
      return invokeFull(execCtx, type, prompt, metadata, buildProviderFn, matchedTasksSummary, resolvedDeps)
  }
}
