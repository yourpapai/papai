// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/types.js'
import { getCachedTools, setCachedTools } from './cache.js'
import { askPermissionViaChat } from './chat/permission-prompt.js'
import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { ActorRole, ReplyFn } from './chat/types.js'
import { buildMessagesWithMemory } from './conversation.js'
import { resolveTimezone } from './llm-orchestrator-config.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import type { TaskProvider } from './providers/types.js'
import { applyResultCompaction } from './tools/compaction/wrap-compaction.js'
import { getToolRetriever } from './tools/disclosure/embedding-tool-retriever.js'
import type { DisclosureSession } from './tools/disclosure/registry.js'
import { LexicalToolRetriever } from './tools/disclosure/tool-retriever.js'
import { maybeApplyDisclosure } from './tools/disclosure/wire.js'
import { resolveReductionFlags } from './tools/feature-flags.js'
import {
  applyGuestReadOnlyFilter,
  applyToolPreferences,
  buildProviderlessToolDescriptors,
  buildToolDescriptors,
} from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Injectable collaborators for prepareLlmInvocation; tests override these instead of mocking modules. */
export interface PrepareLlmInvocationDeps {
  buildToolDescriptors: typeof buildToolDescriptors
  buildProviderlessToolDescriptors: typeof buildProviderlessToolDescriptors
  resolveReductionFlags: typeof resolveReductionFlags
  applyResultCompaction: typeof applyResultCompaction
}

// Built lazily at call time so module-level mocks (mock.module live bindings) still apply.
const defaultDeps = (): PrepareLlmInvocationDeps => ({
  buildToolDescriptors,
  buildProviderlessToolDescriptors,
  resolveReductionFlags,
  applyResultCompaction,
})

const getOrCreateDescriptors = async (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider | null,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
  deps: PrepareLlmInvocationDeps,
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
      ? await deps.buildProviderlessToolDescriptors(descriptorOptions)
      : await deps.buildToolDescriptors(provider, descriptorOptions)
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
  actorRole?: ActorRole
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
  actorRole?: ActorRole
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
    actorRole: src.actorRole,
  }
}

const buildFullToolSet = async (
  opts: LlmInvocationOptions,
  deps: PrepareLlmInvocationDeps,
): Promise<{ tools: ToolSet; enabledToolNames: Set<string>; disclosure: DisclosureSession | undefined }> => {
  const {
    contextId,
    chatUserId,
    username,
    contextType,
    provider,
    userText,
    stagedDownloadFn,
    askPermission,
    actorRole,
  } = opts
  const descriptors = await getOrCreateDescriptors(
    contextId,
    chatUserId,
    username,
    provider,
    contextType,
    stagedDownloadFn,
    deps,
  )
  const prefTools =
    actorRole === 'guest'
      ? applyGuestReadOnlyFilter(descriptors)
      : applyToolPreferences(descriptors, contextId, askPermission)
  // NOTE(forward-safety): meta-tools below (expand_result, search_tools, load_tool) run
  // POST guest-filter; if compaction/disclosure flags are enabled for guests, re-review.
  const flags = deps.resolveReductionFlags(contextId)
  const compacted = deps.applyResultCompaction(prefTools, {
    storageContextId: contextId,
    userIntent: userText,
    enabled: flags.resultCompaction,
  })
  const retriever = flags.semanticToolRetrieval
    ? getToolRetriever(getConfigContextIdFromStorageContextId(contextId), {
        storageContextId: contextId,
        contextType,
        chatUserId,
      })
    : new LexicalToolRetriever()
  const { tools: disclosedTools, disclosure } = maybeApplyDisclosure(compacted, contextId, retriever, {
    enabled: flags.progressiveDisclosure,
  })
  log.debug({ contextId, toolCount: Object.keys(disclosedTools).length }, 'Prepared tool set for LLM invocation')
  return { tools: disclosedTools, enabledToolNames: new Set(Object.keys(disclosedTools)), disclosure }
}

export const prepareLlmInvocation = async (
  opts: LlmInvocationOptions,
  deps: PrepareLlmInvocationDeps = defaultDeps(),
): Promise<{
  tools: ToolSet
  validatedMessages: ModelMessage[]
  enabledToolNames: ReadonlySet<string>
  disclosure: DisclosureSession | undefined
}> => {
  const { contextId, configId, contextType, history } = opts
  const { tools, enabledToolNames, disclosure } = await buildFullToolSet(opts, deps)
  const timezone = resolveTimezone(configId)
  const { messages: messagesWithMemory, memoryMsg } = buildMessagesWithMemory(contextId, history, contextType)
  const validatedMessages = validateToolResults(messagesWithMemory)
  log.debug(
    { contextId, historyLength: history.length, hasMemory: memoryMsg !== null, timezone },
    'Calling generateText',
  )
  return { tools, validatedMessages, enabledToolNames, disclosure }
}
