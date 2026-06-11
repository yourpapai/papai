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
import { applyToolPreferences, buildProviderlessToolDescriptors, buildToolDescriptors } from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const getOrCreateDescriptors = async (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider | null,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): Promise<ToolSet> => {
  const providerCacheScope = provider === null ? 'providerless' : 'provider-backed'
  const stagedDownloadScope = stagedDownloadFn === undefined ? 'no-staged-download' : 'with-staged-download'
  const usernameSuffix = username ?? ''
  const cacheKey = `${providerCacheScope}:${stagedDownloadScope}:${contextId}:${chatUserId}:${usernameSuffix}`
  const cached = getCachedTools(cacheKey)
  if (cached !== undefined && cached !== null && isToolSet(cached)) {
    log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Using cached tool descriptors')
    return cached
  }
  log.debug({ contextId, chatUserId, hasUsername: username !== null }, 'Building tool descriptors (cache miss)')
  const descriptorOptions = {
    storageContextId: contextId,
    chatUserId,
    username,
    contextType,
    stagedDownloadFn,
  }
  const descriptors =
    provider === null
      ? await buildProviderlessToolDescriptors(descriptorOptions)
      : await buildToolDescriptors(provider, descriptorOptions)
  setCachedTools(cacheKey, descriptors)
  return descriptors
}

export type LlmInvocationOptions = {
  contextId: string
  configId: string
  chatUserId: string
  username: string | null
  contextType: 'dm' | 'group'
  provider: TaskProvider | null
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
  provider: TaskProvider | null,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
): LlmInvocationOptions {
  const askPermission: AskPermissionFn = (req) => askPermissionViaChat(src.reply, src.contextId, req)
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
  tools: ToolSet
  validatedMessages: ModelMessage[]
  enabledToolNames: ReadonlySet<string>
}> => {
  const { contextId, configId, chatUserId, username, contextType, provider, history, stagedDownloadFn, askPermission } =
    opts
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
  log.debug(
    {
      contextId,
      toolCount: Object.keys(fullTools).length,
    },
    'Prepared tool set for LLM invocation',
  )
  const timezone = resolveTimezone(configId)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history, contextType)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  return { tools: fullTools, validatedMessages, enabledToolNames }
}
