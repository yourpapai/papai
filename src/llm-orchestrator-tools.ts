// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/types.js'
import { getCachedTools, setCachedTools } from './cache.js'
import { buildMessagesWithMemory } from './conversation.js'
import { resolveTimezone } from './llm-orchestrator-config.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import type { TaskProvider } from './providers/types.js'
import { makeTools } from './tools/index.js'
import { routeToolsForMessage } from './tools/tool-router.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getOrCreateTools = (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): ToolSet => {
  let cacheKey = contextId
  if (contextType === 'group') {
    let usernameSuffix = ''
    if (username !== null) {
      usernameSuffix = username
    }
    cacheKey = `${contextId}:${chatUserId}:${usernameSuffix}`
  }
  const cachedTools = getCachedTools(cacheKey)
  if (cachedTools !== undefined && cachedTools !== null && isToolSet(cachedTools)) {
    log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Using cached tools')
    return cachedTools
  }
  log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Building tools (cache miss)')
  const toolOptions = {
    storageContextId: contextId,
    chatUserId,
    username,
    contextType,
    stagedDownloadFn,
  }
  const tools = makeTools(provider, toolOptions)
  setCachedTools(cacheKey, tools)
  return tools
}

export const prepareLlmInvocation = (
  contextId: string,
  configId: string,
  chatUserId: string,
  username: string | null,
  contextType: 'dm' | 'group',
  provider: TaskProvider,
  history: readonly ModelMessage[],
  userText: string,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): { routingResult: ReturnType<typeof routeToolsForMessage>; validatedMessages: ModelMessage[] } => {
  const fullTools = getOrCreateTools(contextId, chatUserId, username, provider, contextType, stagedDownloadFn)
  const routingResult = routeToolsForMessage(userText, fullTools)
  log.debug(
    {
      contextId,
      routingIntent: routingResult.decision.intent,
      routingConfidence: routingResult.decision.confidence,
      routingReason: routingResult.decision.reason,
      fullToolCount: routingResult.fullToolCount,
      exposedToolCount: routingResult.exposedToolCount,
    },
    'Tool routing selected subset',
  )
  const timezone = resolveTimezone(configId)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  return { routingResult, validatedMessages }
}
