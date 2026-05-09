import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai'

import { getCachedHistory, getCachedTools, setCachedTools } from './cache.js'
import type { ReplyFn } from './chat/types.js'
import { getConfig } from './config.js'
import { buildMessagesWithMemory, runTrimInBackground, shouldTriggerTrim } from './conversation.js'
import { emit } from './debug/event-bus.js'
import { appendHistory, saveHistory } from './history.js'
import { getIdentityMapping } from './identity/mapping.js'
import { attemptAutoLink } from './identity/resolver.js'
import { buildUserTurnMessages } from './llm-orchestrator-attachments.js'
import { checkRequiredConfig, getLlmConfig, resolveConfigId, resolveTimezone } from './llm-orchestrator-config.js'
import { emitLlmEnd, emitLlmStart } from './llm-orchestrator-events.js'
import { handleOrchestratorMessageError, handleToolCallFinish } from './llm-orchestrator-support.js'
import type { InvokeModelArgs, LlmOrchestratorDeps } from './llm-orchestrator-types.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import { extractFactToolCalls, extractFactToolResults } from './memory-tool-steps.js'
import { extractFactsFromSdkResults, upsertFact } from './memory.js'
import { buildProviderForUser } from './providers/factory.js'
import { maybeProvisionKaneo } from './providers/kaneo/provision.js'
import type { TaskProvider } from './providers/types.js'
import { withReplyTypingHeartbeat } from './reply-typing-heartbeat.js'
import { buildSystemPrompt } from './system-prompt.js'
import { makeTools } from './tools/index.js'
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

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && Object.keys(value).length > 0

const cacheUsernamePart = (username: string | null): string => {
  if (username === null) return ''
  return username
}

const getOrCreateTools = (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
  contextType: 'dm' | 'group' | undefined,
): ToolSet => {
  // Security fix: In group chats, tools embed chatUserId-specific closures for "me" resolution.
  // The cache key must include chatUserId to prevent cross-user contamination.
  const cacheKey = contextType === 'group' ? `${contextId}:${chatUserId}:${cacheUsernamePart(username)}` : contextId
  const cachedTools = getCachedTools(cacheKey)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Building tools (cache miss)')
  const tools = makeTools(provider, { storageContextId: contextId, chatUserId, username, contextType })
  setCachedTools(cacheKey, tools)
  return tools
}

const emitLlmError = (contextId: string, configContextId: string | undefined, error: unknown): void => {
  const cfgId = resolveConfigId(contextId, configContextId)
  const model = getConfig(cfgId, 'main_model')
  let emittedModel = 'unknown'
  if (model !== null) {
    emittedModel = model
  }
  emit('llm:error', {
    userId: contextId,
    error: error instanceof Error ? error.message : String(error),
    model: emittedModel,
  })
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

const invokeModel = async (
  args: InvokeModelArgs & { reply: ReplyFn | undefined },
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  const { contextId, mainModel, model, provider, tools, messages, deps, reply } = args
  const start = Date.now()
  emitLlmStart(contextId, mainModel, messages, tools)
  const result = await deps.generateText({
    model,
    system: buildSystemPrompt(provider, contextId),
    messages,
    tools,
    timeout: 1_200_000,
    stopWhen: deps.stepCountIs(25),
    experimental_onToolCallStart(event) {
      emit('llm:tool_call', {
        userId: contextId,
        toolName: event.toolCall.toolName,
        toolCallId: event.toolCall.toolCallId,
        args: event.toolCall.input,
      })
    },
    experimental_onToolCallFinish(event) {
      handleToolCallFinish(contextId, reply, event)
    },
  })
  emitLlmEnd(contextId, mainModel, result, start, messages, tools)
  return result
}

const invokeModelWithTyping = (
  reply: ReplyFn,
  args: InvokeModelArgs,
): ReturnType<LlmOrchestratorDeps['generateText']> => {
  return withReplyTypingHeartbeat(reply, (typingReply) => invokeModel({ ...args, reply: typingReply }))
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

const callLlm = async (
  reply: ReplyFn,
  contextId: string,
  chatUserId: string,
  username: string | null,
  history: readonly ModelMessage[],
  contextType: 'dm' | 'group',
  deps: LlmOrchestratorDeps,
  configContextId: string | undefined,
): Promise<{ response: { messages: ModelMessage[] } }> => {
  const configId = resolveConfigId(contextId, configContextId)
  if (contextType === 'dm') {
    await deps.maybeProvisionKaneo(reply, configId, username)
  }
  const missing = checkRequiredConfig(configId, deps)
  if (missing.length > 0) {
    log.warn({ contextId, configId, missing }, 'Missing required config keys')
    await reply.text(`Missing configuration: ${missing.join(', ')}.\nUse /setup to configure.`)
    throw new Error('Missing configuration')
  }
  const { llmApiKey, llmBaseUrl, mainModel } = getLlmConfig(configId)
  const model = deps.buildOpenAI(llmApiKey, llmBaseUrl)(mainModel)
  const provider = deps.buildProviderForUser(configId)
  await maybeAutoLinkIdentity(chatUserId, username, provider)
  const tools = getOrCreateTools(contextId, chatUserId, username, provider, contextType)
  const timezone = resolveTimezone(configId)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  const result = await invokeModelWithTyping(reply, {
    contextId,
    mainModel,
    model,
    provider,
    tools,
    messages: validatedMessages,
    deps,
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
): Promise<void> => {
  const resolvedDeps = deps
  const resolvedNewAttachmentIds = newAttachmentIds
  log.debug(
    { contextId, configContextId, chatUserId, userText, newAttachmentIds: resolvedNewAttachmentIds },
    'processMessage called',
  )
  log.info({ contextId, chatUserId, messageLength: userText.length }, 'Message received from user')

  const baseHistory = getCachedHistory(contextId)
  const modelName = resolveModelName(contextId, configContextId)
  const { modelMessage, historyMessage } = await buildUserTurnMessages(
    contextId,
    modelName,
    userText,
    resolvedNewAttachmentIds,
  )
  const history = [...baseHistory, historyMessage]
  appendHistory(contextId, [historyMessage])
  try {
    const result = await callLlm(
      reply,
      contextId,
      chatUserId,
      username,
      [...baseHistory, modelMessage],
      contextType,
      resolvedDeps,
      configContextId,
    )
    const assistantMessages = result.response.messages
    appendAssistantHistory(contextId, history, assistantMessages)
  } catch (error) {
    emitLlmError(contextId, configContextId, error)
    saveHistory(contextId, baseHistory)
    await handleOrchestratorMessageError(reply, contextId, error)
  }
}
