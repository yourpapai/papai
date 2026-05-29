// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from '../cache.js'
import { getConfigContextIdFromStorageContextId } from '../chat/scoped-context.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import type { TaskProvider } from '../providers/types.js'
import { getSystemConfig } from '../system-config.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeGetCurrentTimeTool } from '../tools/get-current-time.js'
import { buildFullMessages, buildFullToolSet } from './proactive-llm-full.js'
import {
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  getStorageContextId,
  modelIdForLightweight,
  persistProactiveResults,
  resultTextOrDone,
  type ProactiveLlmDispatchArgs,
  wrapPrompt,
} from './proactive-llm-helpers.js'
import type { ExecutionMetadata } from './types.js'

const log = logger.child({ scope: 'deferred:proactive-llm' })

/** Execution context for a deferred prompt: who created it and where to deliver. */
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

export type BuildProviderFn = (contextId: string) => Promise<TaskProvider | null> | TaskProvider | null

type LlmConfig = { apiKey: string; baseURL: string; mainModel: string }
type DispatchExecutionArgs = ProactiveLlmDispatchArgs<ProactiveLlmDeps, BuildProviderFn>

function getLlmConfigFromSystem(): LlmConfig | string {
  const apiKey = getSystemConfig('llm_apikey')
  const baseURL = getSystemConfig('llm_baseurl')
  const mainModel = getSystemConfig('main_model')
  if (apiKey === null || baseURL === null || mainModel === null) {
    log.warn(
      { hasApiKey: apiKey !== null, hasBaseUrl: baseURL !== null, hasModel: mainModel !== null },
      'Missing LLM system_config for deferred prompt',
    )
    return 'Deferred prompt skipped: the bot is not fully configured. The administrator has been notified.'
  }
  return { apiKey, baseURL, mainModel }
}

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
  log.debug({ userId: createdByUserId, mode: 'lightweight' }, 'invokeLightweight called')
  const config = getLlmConfigFromSystem()
  if (typeof config === 'string') return config

  const smallModel = getSystemConfig('small_model')
  const modelId = modelIdForLightweight(smallModel, config.mainModel)
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
  if (assistantMessages.length > 0) {
    const history = getCachedHistory(storageContextId)
    appendHistory(storageContextId, assistantMessages)
    log.debug(
      { userId: createdByUserId, storageContextId, count: assistantMessages.length },
      'Lightweight response appended to history',
    )
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(storageContextId, updatedHistory)
  }
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
  log.debug({ userId: createdByUserId, mode: 'context' }, 'invokeWithContext called')
  const config = getLlmConfigFromSystem()
  if (typeof config === 'string') return config

  const model = deps.buildModel(config, config.mainModel)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history)
  const messages: ModelMessage[] = [
    ...messagesWithMemory,
    ...buildMetadataMessages(metadata),
    { role: 'user', content: wrapPrompt(prompt) },
  ]

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

  const assistantMessages = result.response.messages
  if (assistantMessages.length > 0) {
    appendHistory(storageContextId, assistantMessages)
    const updatedHistory = [...history, ...assistantMessages]
    if (shouldTriggerTrim(updatedHistory)) void runTrimInBackground(storageContextId, updatedHistory)
  }
  return resultTextOrDone(result.text)
}

async function resolveFullProvider(
  buildProviderFn: BuildProviderFn,
  userId: string,
  storageContextId: string,
  configContextId: string,
): Promise<TaskProvider | string> {
  const provider = await buildProviderFn(configContextId)
  if (provider !== null) return provider
  log.warn({ userId, storageContextId, configContextId }, 'Could not build task provider for deferred prompt')
  return 'Deferred prompt skipped: task provider not configured.'
}

async function runFullGeneration(
  execCtx: DeferredExecutionContext,
  type: 'scheduled' | 'alert',
  prompt: string,
  metadata: ExecutionMetadata,
  matchedTasksSummary: string | undefined,
  config: { apiKey: string; baseURL: string; mainModel: string },
  provider: NonNullable<Awaited<ReturnType<BuildProviderFn>>>,
  deps: ProactiveLlmDeps,
): Promise<string> {
  const { createdByUserId, deliveryTarget } = execCtx
  const storageContextId = getStorageContextId(deliveryTarget)
  const model = deps.buildModel(config, config.mainModel)
  const { tools, enabledToolNames } = await buildFullToolSet(
    provider,
    createdByUserId,
    storageContextId,
    deliveryTarget.contextType,
    prompt,
  )
  const systemPrompt = buildSystemPrompt(provider, storageContextId, enabledToolNames, {
    askPermissionAvailable: false,
  })
  const { messages } = buildFullMessages(createdByUserId, storageContextId, type, prompt, matchedTasksSummary, metadata)
  log.debug(
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: messages.length, mode: 'full' },
    'generateText',
  )
  const result = await deps.generateText({
    model,
    system: systemPrompt,
    messages,
    tools,
    stopWhen: deps.stepCountIs(25),
    timeout: 1_200_000,
  })
  persistProactiveResults(createdByUserId, storageContextId, result, getCachedHistory(storageContextId))
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
  const config = getLlmConfigFromSystem()
  if (typeof config === 'string') return config

  const provider = await resolveFullProvider(buildProviderFn, createdByUserId, storageContextId, configContextId)
  if (typeof provider === 'string') return provider

  return runFullGeneration(execCtx, type, prompt, metadata, matchedTasksSummary, config, provider, deps)
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
