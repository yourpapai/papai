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
import { resolveEffectiveLlmConfig, type EffectiveLlmConfig } from './llm-config-resolver.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import { checkRequiredProviderConfig, resolveConfigId } from './llm-orchestrator-config.js'
import { invokeModelWithTyping } from './llm-orchestrator-invoke.js'
import {
  resolveAttachmentIds,
  resolveDeps,
  resolveTurnId,
  type ProcessMessageRest,
} from './llm-orchestrator-process-args.js'
import { handleLlmTurnError, logProcessMessage } from './llm-orchestrator-support.js'
import { buildLlmInvocationOpts, prepareLlmInvocation, type InvocationSource } from './llm-orchestrator-tools.js'
import type { LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { maybeAutoProvisionProvider } from './providers/auto-provision.js'
import { defaultTaskProviderResolver } from './providers/resolver.js'
import type { TaskProvider } from './providers/types.js'
import { missingSystemConfigKeys } from './system-config.js'
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
  configId: string,
  history: readonly ModelMessage[],
  assistantMessages: ModelMessage[],
): void => {
  if (assistantMessages.length > 0) {
    appendHistory(contextId, assistantMessages)
    log.debug({ contextId, assistantMessagesCount: assistantMessages.length }, 'Assistant response appended to history')
  }
  if (shouldTriggerTrim([...history, ...assistantMessages])) {
    void runTrimInBackground(contextId, [...history, ...assistantMessages], undefined, configId)
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
  await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /config to finish setup in the settings web UI.`)
  throw new Error('Missing configuration')
}

let botMisconfiguredNotified = false

const replyBotMisconfigured = async (reply: ReplyFn, contextId: string): Promise<void> => {
  const missing = missingSystemConfigKeys()
  log.error({ contextId, missing }, 'system_config is incomplete; bot cannot serve this turn')
  await reply.text(
    '⚠️ The bot is not fully configured. Ask the administrator to run /config and complete setup in the web UI.',
  )
  if (!botMisconfiguredNotified) {
    botMisconfiguredNotified = true
    log.warn({ missing }, 'admin notification suppressed for subsequent turns in this process')
  }
}

type LlmConfigFailure = Exclude<ReturnType<typeof resolveEffectiveLlmConfig>, EffectiveLlmConfig>
type ResolvedTurnLlmConfig = EffectiveLlmConfig | null

async function replyByokConfigProblem(reply: ReplyFn, contextId: string, result: LlmConfigFailure): Promise<void> {
  if (result.type === 'missing') {
    log.warn({ contextId, missing: result.missing }, 'BYOK LLM config is incomplete; bot cannot serve this turn')
    await reply.text(
      `BYOK is enabled for this context, but LLM setup is incomplete. Missing: ${result.missing.join(', ')}. Use /config to finish BYOK setup in the settings web UI.`,
    )
    return
  }
  log.warn({ contextId }, 'BYOK LLM config is unreadable; bot cannot serve this turn')
  await reply.text(
    'BYOK credentials for this context are unreadable. Use /config to re-enter the BYOK LLM credentials in the settings web UI.',
  )
}

async function resolveLlmForTurn(reply: ReplyFn, contextId: string, configId: string): Promise<ResolvedTurnLlmConfig> {
  const resolvedLlm = resolveEffectiveLlmConfig(configId)
  if (resolvedLlm.ok) return resolvedLlm
  if (resolvedLlm.source === 'global') {
    await replyBotMisconfigured(reply, contextId)
    return null
  }
  await replyByokConfigProblem(reply, contextId, resolvedLlm)
  return null
}

/** Test-only helper to reset the admin-notified guard between tests. */
export const resetBotMisconfiguredNotifiedForTesting = (): void => {
  botMisconfiguredNotified = false
}

const createProgressReporterForContext = (reply: ReplyFn, contextId: string): AiProgressReporter =>
  createAiProgressReporter(reply, getAiOutputSettings(resolveAiOutputSettingsContextId(contextId)))

type CallLlmArgs = InvocationSource & {
  deps: LlmOrchestratorDeps
  configId: string
  resolvedLlm: EffectiveLlmConfig
  turnId: string
}

const callLlm = async (args: CallLlmArgs): Promise<{ response: { messages: ModelMessage[] } }> => {
  const { reply, contextId, chatUserId, username, contextType, deps, configId, resolvedLlm, turnId } = args
  if (contextType === 'dm') {
    try {
      await deps.maybeAutoProvision(reply, configId, chatUserId, username)
    } catch {
      // Auto-provision is opportunistic; missing or broken hooks should fall through to normal setup guidance.
    }
  }
  const { llmApiKey, llmBaseUrl, mainModel } = resolvedLlm
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = await deps.resolve(configId)
  if (provider === null) {
    log.warn({ contextId, configId }, 'Task provider unavailable for LLM turn; using providerless fallback')
  } else {
    await ensureRequiredConfig(reply, contextId, configId)
    await maybeAutoLinkIdentity(chatUserId, username, provider)
  }
  const { tools, validatedMessages, enabledToolNames } = await prepareLlmInvocation(
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
    tools,
    enabledToolNames,
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

const buildHistory = async (
  contextId: string,
  chatUserId: string,
  modelName: string,
  userText: string,
  attachmentIds: readonly string[],
): Promise<{ baseHistory: readonly ModelMessage[]; modelMessage: ModelMessage; historyMessage: ModelMessage }> => {
  const baseHistory = getCachedHistory(contextId)
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
  const configId = resolveConfigId(contextId, configContextId)
  const resolvedLlm = await resolveLlmForTurn(reply, contextId, configId)
  if (resolvedLlm === null) return
  const turn = await buildHistory(contextId, chatUserId, resolvedLlm.mainModel, userText, newAttachmentIds)
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
      configId,
      resolvedLlm,
      turnId: resolvedTurnId,
    })
    appendAssistantHistory(contextId, configId, [...turn.baseHistory, turn.historyMessage], result.response.messages)
  } catch (error) {
    await handleLlmTurnError({
      reply,
      contextId,
      chatUserId,
      contextType,
      mainModel: resolvedLlm.mainModel,
      startedAt,
      baseHistory: turn.baseHistory,
      error,
      turnId: resolvedTurnId,
    })
  }
}
