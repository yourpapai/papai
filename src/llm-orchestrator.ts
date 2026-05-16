// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage } from 'ai'

import { getCachedHistory } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { appendHistory, saveHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import { checkRequiredConfig, getLlmConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { invokeModelWithTyping } from './llm-orchestrator-invoke.js'
import { emitLlmError, handleOrchestratorMessageError } from './llm-orchestrator-support.js'
import { prepareLlmInvocation } from './llm-orchestrator-tools.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { buildProviderForUser } from './providers/factory.js'
import { maybeProvisionKaneo } from './providers/kaneo/provision.js'
import type { TaskProvider } from './providers/types.js'
import { getKaneoWorkspace } from './users.js'
import { fetchWithoutTimeout } from './utils/fetch.js'

const log = logger.child({ scope: 'llm-orchestrator' })

const defaultDeps: LlmOrchestratorDeps = {
  generateText: (...args) => generateText(...args),
  stepCountIs: (...args) => stepCountIs(...args),
  buildOpenAI: (apiKey: string, baseURL: string) =>
    createOpenAICompatible({ name: 'openai-compatible', apiKey, baseURL, fetch: fetchWithoutTimeout }),
  buildProviderForUser: (userId: string) => buildProviderForUser(userId, true),
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
  const missing = checkRequiredConfig(configId, deps)
  if (missing.length === 0) return
  log.warn({ contextId, configId, missing }, 'Missing required config keys')
  await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /setup to configure.`)
  throw new Error('Missing configuration')
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

const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  history: readonly ModelMessage[],
  userText: string,
  contextType: 'dm' | 'group',
  deps: LlmOrchestratorDeps,
  configContextId: string | undefined,
  turnId: string,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  const configId = resolveConfigId(contextId, configContextId)
  if (contextType === 'dm') {
    await deps.maybeProvisionKaneo(reply, configId, username)
  }
  await ensureRequiredConfig(reply, contextId, configId, deps)
  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig(configId)
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = deps.buildProviderForUser(configId)
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

const resolveModelName = (contextId: string, configContextId: string | undefined): string => {
  const cfgId = resolveConfigId(contextId, configContextId)
  return getConfig(cfgId, 'main_model') ?? ''
}

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
  configContextId: string | undefined,
  userText: string,
  attachmentIds: readonly string[],
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
  const modelName = resolveModelName(contextId, configContextId)
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
  const { baseHistory, modelMessage, historyMessage } = await buildHistory(
    contextId,
    configContextId,
    userText,
    newAttachmentIds,
  )
  appendHistory(contextId, [historyMessage])
  try {
    const result = await callLlm(
      reply,
      contextId,
      chatUserId,
      username,
      [...baseHistory, modelMessage],
      userText,
      contextType,
      deps,
      configContextId,
      resolvedTurnId,
    )
    appendAssistantHistory(contextId, [...baseHistory, historyMessage], result.response.messages)
  } catch (error) {
    emitLlmError(contextId, configContextId, error, resolvedTurnId)
    saveHistory(contextId, baseHistory)
    await handleOrchestratorMessageError(reply, contextId, error)
  }
}
