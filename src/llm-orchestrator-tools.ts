// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/types.js'
import { getCachedTools, setCachedTools } from './cache.js'
import { askPermissionViaChat } from './chat/permission-prompt.js'
import type { ReplyFn } from './chat/types.js'
import { buildMessagesWithMemory } from './conversation.js'
import { resolveTimezone } from './llm-orchestrator-config.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import type { TaskProvider } from './providers/types.js'
import { applyToolPreferences, buildToolDescriptors } from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'
import { routeToolsForMessage } from './tools/tool-router.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getOrCreateDescriptors = async (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): Promise<ToolSet> => {
  let cacheKey = contextId
  if (contextType === 'group') {
    const usernameSuffix = username ?? ''
    cacheKey = `${contextId}:${chatUserId}:${usernameSuffix}`
  }
  const cached = getCachedTools(cacheKey)
  if (cached !== undefined && cached !== null && isToolSet(cached)) {
    log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Using cached tool descriptors')
    return cached
  }
  log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Building tool descriptors (cache miss)')
  const descriptors = await buildToolDescriptors(provider, {
    storageContextId: contextId,
    chatUserId,
    username,
    contextType,
    stagedDownloadFn,
  })
  setCachedTools(cacheKey, descriptors)
  return descriptors
}

export type LlmInvocationOptions = {
  contextId: string
  configId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  provider: TaskProvider
  history: readonly ModelMessage[]
  userText: string
  stagedDownloadFn: StagedFileDownloadFn | undefined
  askPermission: AskPermissionFn | undefined
}

/** Minimal shape of args required to build LlmInvocationOptions from a callLlm context. */
export type InvocationSource = {
  reply: ReplyFn
  contextId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  history: readonly ModelMessage[]
  userText: string
}

/** Constructs LlmInvocationOptions by binding askPermissionViaChat to the reply surface. */
export function buildLlmInvocationOpts(
  src: InvocationSource,
  configId: string,
  provider: TaskProvider,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): LlmInvocationOptions {
  const askPermission: AskPermissionFn = (req) => askPermissionViaChat(src.reply, configId, req)
  return {
    contextId: src.contextId,
    configId,
    chatUserId: src.chatUserId,
    username: src.username,
    contextType: src.contextType,
    provider,
    history: src.history,
    userText: src.userText,
    stagedDownloadFn,
    askPermission,
  }
}

export const prepareLlmInvocation = async (
  opts: LlmInvocationOptions,
): Promise<{
  routingResult: ReturnType<typeof routeToolsForMessage>
  validatedMessages: ModelMessage[]
  enabledToolNames: ReadonlySet<string>
}> => {
  const {
    contextId,
    configId,
    chatUserId,
    username,
    contextType,
    provider,
    history,
    userText,
    stagedDownloadFn,
    askPermission,
  } = opts
  const descriptors = await getOrCreateDescriptors(
    contextId,
    chatUserId,
    username,
    provider,
    contextType,
    stagedDownloadFn,
  )
  const fullTools = applyToolPreferences(descriptors, contextId, askPermission)
  const enabledToolNames = new Set(Object.keys(fullTools))
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
  return { routingResult, validatedMessages, enabledToolNames }
}
