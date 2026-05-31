// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getAiOutputSettings } from './ai-output-settings.js'
import { createAiProgressReporter, type AiProgressReporter } from './ai-progress-reporter.js'
import { getCachedHistory } from './cache.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ReplyFn } from './chat/types.js'
import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import { checkRequiredProviderConfig, getLlmConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { invokeModelWithTyping } from './llm-orchestrator-invoke.js'
import {
  resolveAttachmentIds,
  resolveDeps,
  resolveTurnId,
  type ProcessMessageRest,
} from './llm-orchestrator-process-args.js'
import { handleLlmTurnError, logProcessMessage } from './llm-orchestrator-support.js'
import { buildLlmInvocationOpts, prepareLlmInvocation } from './llm-orchestrator-tools.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { maybeAutoProvisionProvider } from './providers/auto-provision.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { getSystemConfig, isSystemConfigComplete, missingSystemConfigKeys } from './system-config.js'
import { fetchWithoutTimeout } from './utils/fetch.js'

const log = logger.child({ scope: 'llm-orchestrator' })

export const resolveAiOutputSettingsContextId = (contextId: string): string =>
  getConfigContextIdFromStorageContextId(contextId)

const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildOpenAI: (apiKey: string, baseURL: string) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout }),
  resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
  maybeAutoProvision: (reply, contextId, chatUserId, username) =>
    maybeAutoProvisionProvider(reply, contextId, chatUserId, username),
}
export { defaultDeps }

const persistFactsFromResults = (contextId: string, result: unknown): void => {
  const toolCalls = extractFactToolCalls(result)
  const toolResults = extractFactToolResults(result)
  const newFacts = extractFactsFromSdkResults(toolCalls, toolResults)
  if (newFacts.length === 0) return
  for (const fact of newFacts) upsertFact(contextId, fact)
  log.info(
    { contextId, factsExtracted: newFacts.length, factsUpserted: newFacts.length },
    'Facts extracted and persisted',
  )
}

const appendAssistantHistory = (
  contextId: string,
  history: readonly ModelMessage[],
  assistantMessages: ModelMessage[],
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  if (shouldTriggerTrim([...history, ...assistantMessages])) {
    void runTrimInBackground(contextId, [...history, ...assistantMessages])
  }
}

const sendLlmResponse = async (
  reply: ReplyFn,
  contextId: string,
  result: { text: string | undefined; toolCalls: unknown[] | undefined; response: { messages: ModelMessage[] } },
  progressReporter: AiProgressReporter | undefined,
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  await reply.formatted(textToFormat)
  if (progressReporter === undefined) {
    log.info({ contextId, responseLength, toolCalls: toolCallCount }, 'Response sent successfully')
    return
  }
  try {
    await progressReporter.flush()
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'AI progress details flush failed after final response',
    )
  }
  log.info({ contextId, responseLength, toolCalls: toolCallCount }, 'Response sent successfully')
}

const maybeAutoLinkIdentity = async (
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
): Promise<void> => {
  if (username === null || provider.identityResolver === undefined) return
  const existingMapping = getIdentityMapping(chatUserId, provider.name)
  if (existingMapping !== null) return
  log.debug({ chatUserId, username }, 'Attempting auto-link for first group interaction')
  const autoLinkResult = await attemptAutoLink(chatUserId, username, provider)
  if (autoLinkResult.type === 'found') {
    log.info({ chatUserId, login: autoLinkResult.identity.login }, 'Auto-linked user on first interaction')
  } else {
    log.debug({ chatUserId, username, result: autoLinkResult.type }, 'Auto-link did not find match')
  }
}

const ensureRequiredConfig = async (reply: ReplyFn, contextId: string, configId: string): Promise<void> => {
  const missing = checkRequiredProviderConfig(configId)
  if (missing.length === 0) return
  log.warn({ contextId, configId, missing }, 'Missing required provider config keys')
  await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /setup to configure.`)
  throw new Error('Missing configuration')
}

let botMisconfiguredNotified = false

const replyBotMisconfigured = async (reply: ReplyFn, contextId: string): Promise<void> => {
  const missing = missingSystemConfigKeys()
  log.error({ contextId, missing }, 'system_config is incomplete; bot cannot serve this turn')
  await reply.text('⚠️ The bot is not fully configured. The administrator has been notified.')
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ missing }, 'admin notification suppressed for subsequent turns in this process')
  }
}

/** Test-only helper to reset the admin-notified guard between tests. */
export const resetBotMisconfiguredNotifiedForTesting = (): void => {
  botMisconfiguredNotified = false
}

const buildToolRoutingTelemetry = (
  routingResult: Awaited<ReturnType<typeof prepareLlmInvocation>>['routingResult'],
): InvokeModelArgs['toolRouting'] => ({
  intent: routingResult.decision.intent,
  confidence: routingResult.decision.confidence,
  reason: routingResult.decision.reason,
  fullToolCount: routingResult.fullToolCount,
  exposedToolCount: routingResult.exposedToolCount,
})

const createProgressReporterForContext = (reply: ReplyFn, contextId: string): AiProgressReporter =>
  createAiProgressReporter(reply, getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)))

type CallLlmArgs = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  username: string | null
  history: readonly ModelMessage[]
  userText: string
  contextType: 'dm' | 'group'
  deps: LlmOrchestratorDeps
  configContextId: string | undefined
  turnId: string
}

const callLlm = async (args: CallLlmArgs): Promise<{ response: { messages: ModelMessage[] } }> => {
  const { reply, contextId, chatUserId, username, contextType, deps, configContextId, turnId } = args
  const configId = resolveConfigId(contextId, configContextId)
  if (contextType === 'dm') {
    await deps.maybeAutoProvision(reply, configId, chatUserId, username)
  }
  await ensureRequiredConfig(reply, contextId, configId)
  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig()
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = await deps.resolve(configId)
  if (provider === null) {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn')
    await reply.text('I need /setup before I can do that.')
    return { response: { messages: [] } }
  }
  await maybeAutoLinkIdentity(chatUserId, username, provider)
  const { routingResult, validatedMessages, enabledToolNames } = await prepareLlmInvocation(
    buildLlmInvocationOpts(args, configId, provider, deps.stagedDownloadFn),
  )
  const progressReporter = createProgressReporterForContext(reply, contextId)
  const result = await invokeModelWithTyping(reply, {
    contextId,
    chatUserId,
    contextType,
    mainModel,
    model,
    provider,
    tools: routingResult.tools,
    enabledToolNames,
    toolRouting: buildToolRoutingTelemetry(routingResult),
    messages: validatedMessages,
    deps,
    progressReporter,
    turnId,
  })
  const toolCallCount = result.toolCalls === undefined ? undefined : result.toolCalls.length
  log.debug({ contextId, toolCalls: toolCallCount, usage: result.usage }, 'LLM response received')
  progressReporter.reasoning(result.reasoningText, result.reasoning)
  persistFactsFromResults(contextId, result)
  await sendLlmResponse(reply, contextId, result, progressReporter)
  return result
}

const resolveModelName = (): string => {
  const modelName = getSystemConfig('main_model')
  if (modelName === null) return ''
  return modelName
}

const buildHistory = async (
  contextId: string,
  chatUserId: string,
  userText: string,
  attachmentIds: readonly string[],
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
  const modelName = resolveModelName()
  const { modelMessage, historyMessage } = await buildUserTurnMessages(
    contextId,
    chatUserId,
    modelName,
    userText,
    attachmentIds,
  )
  return { baseHistory, modelMessage, historyMessage }
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  ...rest: ProcessMessageRest
): Promise<void> => {
  const [configContextId, depsInput, newAttachmentIdsInput, turnId] = rest
  const deps = resolveDeps(depsInput, defaultDeps)
  const newAttachmentIds = resolveAttachmentIds(newAttachmentIdsInput)
  const resolvedTurnId = resolveTurnId(turnId)
  logProcessMessage(contextId, configContextId, chatUserId, userText, newAttachmentIds, resolvedTurnId)
  if (!isSystemConfigComplete()) {
    await replyBotMisconfigured(reply, contextId)
    return
  }
  const turn = await buildHistory(contextId, chatUserId, userText, newAttachmentIds)
  appendHistory(contextId, [turn.historyMessage])
  const startedAt = Date.now()
  try {
    const result = await callLlm({
      reply,
      contextId,
      chatUserId,
      username,
      history: [...turn.baseHistory, turn.modelMessage],
      userText,
      contextType,
      deps,
      configContextId,
      turnId: resolvedTurnId,
    })
    appendAssistantHistory(contextId, [...turn.baseHistory, turn.historyMessage], result.response.messages)
  } catch (error) {
    await handleLlmTurnError({
      reply,
      contextId,
      chatUserId,
      contextType,
      mainModel: resolveModelName(),
      startedAt,
      baseHistory: turn.baseHistory,
      error,
      turnId: resolvedTurnId,
    })
  }
}
