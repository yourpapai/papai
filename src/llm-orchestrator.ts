// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory, saveHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import { checkRequiredProviderConfig, getLlmConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { invokeModelWithTyping } from './llm-orchestrator-invoke.js'
import { emitLlmError, handleOrchestratorMessageError } from './llm-orchestrator-support.js'
import { prepareLlmInvocation } from './llm-orchestrator-tools.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { maybeProvisionKaneo } from './providers/kaneo/provision.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { getSystemConfig, isSystemConfigComplete, missingSystemConfigKeys } from './system-config.js'
import { getKaneoWorkspace } from './users.js'
import { fetchWithoutTimeout } from './utils/fetch.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildOpenAI: (apiKey: string, baseURL: string) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout }),
  resolve: (contextId: string) => defaultTaskProviderResolver.resolve(contextId),
  getKaneoWorkspace,
  maybeProvisionKaneo: (reply, contextId, username) => maybeProvisionKaneo(reply, contextId, username),
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
): Promise<void> => {
  const textToFormat = result.text !== undefined && result.text !== '' ? result.text : 'Done.'
  const responseLength = result.text === undefined ? 0 : result.text.length
  const toolCallCount = result.toolCalls === undefined ? 0 : result.toolCalls.length
  await reply.formatted(textToFormat)
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

const ensureRequiredConfig = async (
  reply: ReplyFn,
  contextId: string,
  configId: string,
  deps: LlmOrchestratorDeps,
): Promise<void> => {
  const missing = checkRequiredProviderConfig(configId, deps)
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
  routingResult: ReturnType<typeof prepareLlmInvocation>['routingResult'],
): InvokeModelArgs['toolRouting'] => ({
  intent: routingResult.decision.intent,
  confidence: routingResult.decision.confidence,
  reason: routingResult.decision.reason,
  fullToolCount: routingResult.fullToolCount,
  exposedToolCount: routingResult.exposedToolCount,
})

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
  const { reply, contextId, chatUserId, username, history, userText, contextType, deps, configContextId, turnId } = args
  const configId = resolveConfigId(contextId, configContextId)
  if (contextType === 'dm') {
    await deps.maybeProvisionKaneo(reply, configId, username)
  }
  await ensureRequiredConfig(reply, contextId, configId, deps)
  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig()
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = deps.resolve(configId)
  if (provider === null) {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn')
    await reply.text('I need /setup before I can do that.')
    return { response: { messages: [] } }
  }
  await maybeAutoLinkIdentity(chatUserId, username, provider)
  const { routingResult, validatedMessages } = prepareLlmInvocation(
    contextId,
    configId,
    chatUserId,
    username,
    contextType,
    provider,
    history,
    userText,
    deps.stagedDownloadFn,
  )
  const result = await invokeModelWithTyping(reply, {
    contextId,
    chatUserId,
    contextType,
    mainModel,
    model,
    provider,
    tools: routingResult.tools,
    toolRouting: buildToolRoutingTelemetry(routingResult),
    messages: validatedMessages,
    deps,
    turnId,
  })
  const toolCallCount = result.toolCalls === undefined ? undefined : result.toolCalls.length
  log.debug({ contextId, toolCalls: toolCallCount, usage: result.usage }, 'LLM response received')
  persistFactsFromResults(contextId, result)
  await sendLlmResponse(reply, contextId, result)
  return result
}

const resolveModelName = (): string => getSystemConfig('main_model') ?? ''

const logProcessMessage = (
  contextId: string,
  configContextId: string | undefined,
  chatUserId: string,
  userText: string,
  attachmentIds: readonly string[],
  turnId: string,
): void => {
  log.debug(
    { contextId, configContextId, chatUserId, userText, newAttachmentIds: attachmentIds, turnId },
    'processMessage called',
  )
  log.info({ contextId, chatUserId, messageLength: userText.length, turnId }, 'Message received from user')
}

const buildHistory = async (
  contextId: string,
  userText: string,
  attachmentIds: readonly string[],
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
  const modelName = resolveModelName()
  const { modelMessage, historyMessage } = await buildUserTurnMessages(contextId, modelName, userText, attachmentIds)
  return { baseHistory, modelMessage, historyMessage }
}

export const processMessage = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  userText: string,
  contextType: 'dm' | 'group',
  configContextId?: string,
  deps: LlmOrchestratorDeps = defaultDeps,
  newAttachmentIds: readonly string[] = [],
  turnId?: string,
): Promise<void> => {
  const resolvedTurnId = turnId ?? crypto.randomUUID()
  logProcessMessage(contextId, configContextId, chatUserId, userText, newAttachmentIds, resolvedTurnId)
  if (!isSystemConfigComplete()) {
    await replyBotMisconfigured(reply, contextId)
    return
  }
  const { baseHistory, modelMessage, historyMessage } = await buildHistory(contextId, userText, newAttachmentIds)
  appendHistory(contextId, [historyMessage])
  const failureCtx: ProcessFailureContext = {
    contextId,
    chatUserId,
    contextType,
    mainModel: resolveModelName(),
    startedAt: Date.now(),
    messageCount: baseHistory.length + 1,
    turnId: resolvedTurnId,
    baseHistory,
  }
  try {
    const result = await callLlm({
      reply,
      contextId,
      chatUserId,
      username,
      history: [...baseHistory, modelMessage],
      userText,
      contextType,
      deps,
      configContextId,
      turnId: resolvedTurnId,
    })
    appendAssistantHistory(contextId, [...baseHistory, historyMessage], result.response.messages)
  } catch (error) {
    await handleProcessFailure(reply, failureCtx, error)
  }
}

type ProcessFailureContext = {
  contextId: string
  chatUserId: string
  contextType: 'dm' | 'group'
  mainModel: string
  startedAt: number
  messageCount: number
  turnId: string
  baseHistory: readonly ModelMessage[]
}

const handleProcessFailure = async (reply: ReplyFn, ctx: ProcessFailureContext, error: unknown): Promise<void> => {
  emitLlmError(
    ctx.contextId,
    ctx.chatUserId,
    ctx.contextType,
    ctx.mainModel,
    ctx.startedAt,
    ctx.messageCount,
    error,
    ctx.turnId,
  )
  saveHistory(ctx.contextId, ctx.baseHistory)
  await handleOrchestratorMessageError(reply, ctx.contextId, error)
}
