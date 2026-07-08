// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/types.js'
import { getCachedTools, setCachedTools } from './cache.js'
import type { ChatParticipantResolver } from './chat/participants/roster.js'
import { askPermissionViaChat } from './chat/permission-prompt.js'
import { getConfigContextIdFromStorageContextId, parseScopedContextId } from './chat/scoped-context.js'
import type { ActorRole, ReplyFn } from './chat/types.js'
import { resolveCodingGuardrails } from './coding-credentials/guardrails.js'
import { buildMessagesWithMemory } from './conversation.js'
import { resolveTimezone } from './llm-orchestrator-config.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import { toolGateRegistry, type ToolGateRegistry } from './ports/tool-gate.js'
import type { TaskProvider } from './providers/types.js'
import { applyResultCompaction } from './tools/compaction/wrap-compaction.js'
import { getToolRetriever } from './tools/disclosure/embedding-tool-retriever.js'
import type { DisclosureSession } from './tools/disclosure/registry.js'
import { maybeApplyDisclosure } from './tools/disclosure/wire.js'
import {
  applyGuestReadOnlyFilter,
  applyToolPreferences,
  buildProviderlessToolDescriptors,
  buildToolDescriptors,
} from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

// ---------------------------------------------------------------------------
// Who-may-use filter: drops operator-gated tools for actors not on the
// operator allowlist. Which tools are operator-gated is declared by the tools
// themselves (ToolGatePort) — core never enumerates tool names.
// ---------------------------------------------------------------------------

/**
 * Drops operator-gated tools for actors not on the who-may-use allowlist.
 * Returns `tools` reference-identical when `whoMayUse === 'members'` (the default) or when
 * the actor is on the allowlist.
 */
export function applyWhoMayUseFilter(
  tools: ToolSet,
  whoMayUse: 'members' | string[],
  chatUserId: string,
  gateRegistry: ToolGateRegistry = toolGateRegistry,
): ToolSet {
  if (whoMayUse === 'members') return tools
  if (whoMayUse.includes(chatUserId)) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t !== undefined && !gateRegistry.isOperatorGated(name)) out[name] = t
  }
  return out
}

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Injectable collaborators for prepareLlmInvocation; tests override these instead of mocking modules. */
export interface PrepareLlmInvocationDeps {
  buildToolDescriptors: typeof buildToolDescriptors
  buildProviderlessToolDescriptors: typeof buildProviderlessToolDescriptors
  applyResultCompaction: typeof applyResultCompaction
}

// Built lazily at call time so module-level mocks (mock.module live bindings) still apply.
const defaultDeps = (): PrepareLlmInvocationDeps => ({
  buildToolDescriptors,
  buildProviderlessToolDescriptors,
  applyResultCompaction,
})

const getOrCreateDescriptors = async (
  contextId: string,
  chatUserId: string,
  username: string | null,
  provider: TaskProvider | null,
  contextType: 'dm' | 'group' | undefined,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
  chatParticipantResolver: ChatParticipantResolver | undefined,
  deps: PrepareLlmInvocationDeps,
): Promise<ToolSet> => {
  const providerCacheScope = provider === null ? 'providerless' : 'provider-backed'
  const stagedDownloadScope = stagedDownloadFn === undefined ? 'no-staged-download' : 'with-staged-download'
  const resolverScope = chatParticipantResolver === undefined ? 'no-resolver' : 'with-resolver'
  const usernameSuffix = username ?? ''
  const cacheKey = `${providerCacheScope}:${stagedDownloadScope}:${resolverScope}:${contextId}:${chatUserId}:${usernameSuffix}`
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
    chatParticipantResolver,
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
  chatParticipantResolver?: ChatParticipantResolver
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

const applyCompactionAndDisclosure = (
  prefTools: ToolSet,
  contextId: string,
  chatUserId: string,
  contextType: 'dm' | 'group',
  userText: string,
  deps: PrepareLlmInvocationDeps,
): { tools: ToolSet; disclosure: DisclosureSession | undefined } => {
  // NOTE(forward-safety): meta-tools below (expand_result, search_tools, load_tool) run
  // POST guest-filter; if this surface should differ for guests, re-review.
  const compacted = deps.applyResultCompaction(prefTools, {
    storageContextId: contextId,
    userIntent: userText,
  })
  const retriever = getToolRetriever(getConfigContextIdFromStorageContextId(contextId), {
    storageContextId: contextId,
    contextType,
    chatUserId,
  })
  const { tools: disclosedTools, disclosure } = maybeApplyDisclosure(compacted, contextId, retriever)
  return { tools: disclosedTools, disclosure }
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
    chatParticipantResolver,
  } = opts
  const descriptors = await getOrCreateDescriptors(
    contextId,
    chatUserId,
    username,
    provider,
    contextType,
    stagedDownloadFn,
    chatParticipantResolver,
    deps,
  )
  const prefTools =
    actorRole === 'guest'
      ? applyGuestReadOnlyFilter(descriptors)
      : applyToolPreferences(descriptors, contextId, askPermission)
  const pi = parseScopedContextId(contextId)?.platformInstanceId
  const gatedTools =
    pi === undefined ? prefTools : applyWhoMayUseFilter(prefTools, resolveCodingGuardrails(pi).whoMayUse, chatUserId)
  const { tools: disclosedTools, disclosure } = applyCompactionAndDisclosure(
    gatedTools,
    contextId,
    chatUserId,
    contextType,
    userText,
    deps,
  )
  log.debug(
    { contextId, toolCount: Object.keys(disclosedTools).length, gated: gatedTools !== prefTools },
    'Prepared tool set for LLM invocation',
  )
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
