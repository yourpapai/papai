import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory } from '../cache.js'
import type { DeferredDeliveryTarget } from '../chat/types.js'
import { getConfig } from '../config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from '../conversation.js'
import { appendHistory } from '../history.js'
import { logger } from '../logger.js'
import { extractFactToolCalls, extractFactToolResults } from '../memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from '../memory.js'
import type { TaskProvider } from '../providers/types.js'
import { buildSystemPrompt } from '../system-prompt.js'
import { makeGetCurrentTimeTool } from '../tools/get-current-time.js'
import { makeTools } from '../tools/index.js'
import {
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  getStorageContextId,
  modelIdForLightweight,
  resultTextOrDone,
  timezoneOrUtc,
  toolCallCount,
  type ProactiveLlmDispatchArgs,
  wrapPrompt,
} from './proactive-llm-helpers.js'
import { buildProactiveTrigger } from './proactive-trigger.js'
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

export type BuildProviderFn = (userId: string) => TaskProvider | null

type LlmConfig = { apiKey: string; baseURL: string; mainModel: string }
type DispatchExecutionArgs = ProactiveLlmDispatchArgs<ProactiveLlmDeps, BuildProviderFn>

function getLlmConfig(userId: string): LlmConfig | string {
  const apiKey = getConfig(userId, 'llm_apikey')
  const baseURL = getConfig(userId, 'llm_baseurl')
  const mainModel = getConfig(userId, 'main_model')
  if (apiKey === null || baseURL === null || mainModel === null) {
    log.warn(
      { userId, hasApiKey: apiKey !== null, hasBaseUrl: baseURL !== null, hasModel: mainModel !== null },
      'Missing LLM config for deferred prompt',
    )
    return 'Deferred prompt skipped: missing LLM configuration. Use /setup to configure llm_apikey, llm_baseurl, and main_model.'
  }
  return { apiKey, baseURL, mainModel }
}

const resolveDeps = (deps: ProactiveLlmDeps | undefined): ProactiveLlmDeps => {
  if (deps === undefined) return defaultProactiveLlmDeps
  return deps
}

type LlmResult = Awaited<ReturnType<typeof generateText>>

function persistProactiveResults(
  creatorId: string,
  storageContextId: string,
  result: LlmResult,
  history: readonly ModelMessage[],
): void {
  const newFacts = extractFactsFromSdkResults(extractFactToolCalls(result), extractFactToolResults(result))
  for (const fact of newFacts) upsertFact(storageContextId, fact)
  if (newFacts.length > 0)
    log.info(
      { userId: creatorId, storageContextId, factsExtracted: newFacts.length },
      'Facts persisted from proactive results',
    )

  const msgs = result.response.messages
  if (msgs.length > 0) {
    appendHistory(storageContextId, msgs)
    const updated = [...history, ...msgs]
    if (shouldTriggerTrim(updated)) void runTrimInBackground(storageContextId, updated)
  }
  log.debug({ userId: creatorId, toolCalls: toolCallCount(result) }, 'Proactive LLM response received')
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
  const config = getLlmConfig(createdByUserId)
  if (typeof config === 'string') return config

  const smallModel = getConfig(createdByUserId, 'small_model')
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
  const config = getLlmConfig(createdByUserId)
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
    { userId: createdByUserId, mainModel: config.mainModel, historyLength: history.length, mode: 'context' },
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

function buildFullToolSet(
  provider: TaskProvider,
  createdByUserId: string,
  storageContextId: string,
  contextType: 'dm' | 'group',
): ToolSet {
  return makeTools(provider, {
    storageContextId,
    chatUserId: createdByUserId,
    mode: 'proactive',
    contextType,
  })
}

function buildFullMessages(
  createdByUserId: string,
  storageContextId: string,
  type: 'scheduled' | 'alert',
  prompt: string,
  matchedTasksSummary: string | undefined,
  metadata: ExecutionMetadata,
): { messages: ModelMessage[]; systemPrompt: string } {
  const timezone = timezoneOrUtc(getConfig(createdByUserId, 'timezone'))
  const trigger = buildProactiveTrigger(type, prompt, timezone, matchedTasksSummary)
  const history = getCachedHistory(storageContextId)
  const { messages: messagesWithMemory } = buildMessagesWithMemory(storageContextId, history)
  return {
    messages: [
      ...messagesWithMemory,
      { role: 'system', content: trigger.systemContext },
      ...buildMetadataMessages(metadata),
      { role: 'user', content: trigger.userContent },
    ],
    systemPrompt: trigger.systemContext,
  }
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
  log.debug({ userId: createdByUserId, mode: 'full' }, 'invokeFull called')
  const config = getLlmConfig(createdByUserId)
  if (typeof config === 'string') return config

  const provider = buildProviderFn(createdByUserId)
  if (provider === null) {
    log.warn({ userId: createdByUserId }, 'Could not build task provider for deferred prompt')
    return 'Deferred prompt skipped: task provider not configured.'
  }

  const model = deps.buildModel(config, config.mainModel)
  const tools = buildFullToolSet(provider, createdByUserId, storageContextId, deliveryTarget.contextType)
  const systemPrompt = buildSystemPrompt(provider, createdByUserId)
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
