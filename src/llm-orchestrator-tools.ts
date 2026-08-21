// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage, ToolSet } from 'ai'

import { runWithProviderRequestScope } from './analytics/provider-request-scope.js'
import type { ProviderRequestScope } from './analytics/provider-request-scope.js'
import type { StagedFileDownloadFn } from './attachments/index.js'
import type { ChatParticipantResolver } from './chat/participants/roster.js'
import { askPermissionViaChat } from './chat/permission-prompt.js'
import { getConfigContextIdFromStorageContextId, parseScopedContextId } from './chat/scoped-context.js'
import type { ActorRole, ReplyFn } from './chat/types.js'
import { resolveCodingGuardrails } from './coding-credentials/guardrails.js'
import { buildMessagesWithMemory } from './conversation.js'
import { resolveTimezone } from './llm-orchestrator-config.js'
import { getOrCreateDescriptors } from './llm-orchestrator-descriptor-cache.js'
import { validateToolResults } from './llm-orchestrator-validation.js'
import { logger } from './logger.js'
import type { TaskProvider } from './providers/types.js'
import { toolCapabilityCatalog } from './runtime/capability-catalog.js'
import { resolveContextLocale } from './tool-failure.js'
import { applyResultCompaction } from './tools/compaction/wrap-compaction.js'
import { registerMcpToolCapabilities, registerOfferedCoreToolCapabilities } from './tools/core-capabilities.js'
import { getToolRetriever } from './tools/disclosure/embedding-tool-retriever.js'
import type { DisclosureSession } from './tools/disclosure/registry.js'
import { maybeApplyDisclosure } from './tools/disclosure/wire.js'
import { emitResolvedSurfaceOpportunities } from './tools/feature-opportunities.js'
import {
  applyGuestReadOnlyFilter,
  applyToolPreferences,
  buildProviderlessToolDescriptors,
  buildToolDescriptors,
} from './tools/index.js'
import type { AskPermissionFn } from './tools/permission-gate.js'
import { finalizeProviderScopedTools } from './tools/wrap-tool-execution.js'

const log = logger.child({ scope: 'llm-orchestrator:tools' })

// ---------------------------------------------------------------------------
// Who-may-use filter: gates acp state-changing tools per operator guardrails
// ---------------------------------------------------------------------------

const ACP_SESSION_ACTION_TOOLS = new Set([
  'plugin_acp__start_session',
  'plugin_acp__continue_session',
  'plugin_acp__finish_session',
  'plugin_acp__cancel_session',
  'plugin_acp__answer_permission',
])

/**
 * Drops ACP session-action tools for actors not on the who-may-use allowlist.
 * Returns `tools` reference-identical when `whoMayUse === 'members'` (the default).
 */
export function applyWhoMayUseFilter(tools: ToolSet, whoMayUse: 'members' | string[], chatUserId: string): ToolSet {
  if (whoMayUse === 'members') return tools
  if (whoMayUse.includes(chatUserId)) return tools
  const out: ToolSet = {}
  for (const [name, t] of Object.entries(tools)) {
    if (t !== undefined && !ACP_SESSION_ACTION_TOOLS.has(name)) out[name] = t
  }
  return out
}

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
  providerRequestScope: ProviderRequestScope
  actorRole?: ActorRole
  chatParticipantResolver?: ChatParticipantResolver
  /** Whether the acting user is a bot admin; absent means not an admin. */
  isBotAdmin?: boolean
  /** Platform instance the turn originated from; absent when unknown. */
  platformInstanceId?: string
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
  /** Whether the acting user is a bot admin; absent means not an admin. */
  isBotAdmin?: boolean
  /** Platform instance the turn originated from; absent when unknown. */
  platformInstanceId?: string
}

/** Constructs LlmInvocationOptions by binding askPermissionViaChat to the reply surface. */
export function buildLlmInvocationOpts(
  src: InvocationSource,
  configId: string,
  provider: TaskProvider | null,
  stagedDownloadFn: StagedFileDownloadFn | undefined,
  providerRequestScope: ProviderRequestScope,
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
    providerRequestScope,
    actorRole: src.actorRole,
    isBotAdmin: src.isBotAdmin,
    platformInstanceId: src.platformInstanceId,
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

const applyGateFilters = (descriptors: ToolSet, opts: LlmInvocationOptions): ToolSet => {
  const { contextId, chatUserId, askPermission, actorRole } = opts
  const prefTools =
    actorRole === 'guest'
      ? applyGuestReadOnlyFilter(descriptors)
      : applyToolPreferences(descriptors, contextId, askPermission)
  const pi = parseScopedContextId(contextId)?.platformInstanceId
  return pi === undefined
    ? prefTools
    : applyWhoMayUseFilter(prefTools, resolveCodingGuardrails(pi).whoMayUse, chatUserId)
}

/**
 * Per-invocation opportunity observation: runs on cache hits AND misses so the
 * (actor, feature, UTC day) series does not collapse behind the descriptor
 * cache. The deterministic source reference dedupes to one durable row per
 * day. Skips silently for non-actor scopes (e.g. guests).
 */
const observeInvocationSurface = (opts: LlmInvocationOptions, descriptors: ToolSet): void => {
  emitResolvedSurfaceOpportunities({
    mode: 'normal',
    contextType: opts.contextType,
    storageContextId: opts.contextId,
    chatUserId: opts.chatUserId,
    hasProvider: opts.provider !== null,
    tools: descriptors,
    requestContext: opts.providerRequestScope.kind === 'actor' ? opts.providerRequestScope.requestContext : null,
  })
}

const buildFullToolSet = async (
  opts: LlmInvocationOptions,
  deps: PrepareLlmInvocationDeps,
): Promise<{ tools: ToolSet; enabledToolNames: Set<string>; disclosure: DisclosureSession | undefined }> => {
  const { contextId, chatUserId, contextType, userText, providerRequestScope } = opts
  // The scope wraps the whole descriptor-cache lookup (not just the miss
  // branch): an MCP connect/listTools on a miss sees the current ephemeral
  // scope, while cached descriptors retain no actor state.
  const descriptors = await runWithProviderRequestScope(providerRequestScope, () =>
    getOrCreateDescriptors(
      opts.contextId,
      opts.chatUserId,
      opts.username,
      opts.provider,
      opts.contextType,
      opts.stagedDownloadFn,
      opts.chatParticipantResolver,
      deps,
      opts.isBotAdmin,
      opts.platformInstanceId,
    ),
  )
  observeInvocationSurface(opts, descriptors)
  const gatedTools = applyGateFilters(descriptors, opts)
  registerOfferedCoreToolCapabilities(gatedTools, toolCapabilityCatalog)
  registerMcpToolCapabilities(gatedTools, toolCapabilityCatalog)
  const { tools: disclosedTools, disclosure } = applyCompactionAndDisclosure(
    gatedTools,
    contextId,
    chatUserId,
    contextType,
    userText,
    deps,
  )
  toolCapabilityCatalog.register('meta.search-tools', 'search_tools')
  // Single final pass: attach the strict ProviderRequestScope contextSchema and
  // outer execution wrapper to every executable descriptor (including the real
  // search_tools/load_tool). No later step may create or replace a tool.
  const tools = finalizeProviderScopedTools(
    disclosedTools,
    resolveContextLocale(getConfigContextIdFromStorageContextId(contextId)),
  )
  log.debug(
    { contextId, toolCount: Object.keys(tools).length, gated: gatedTools !== descriptors },
    'Prepared tool set for LLM invocation',
  )
  return { tools, enabledToolNames: new Set(Object.keys(tools)), disclosure }
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
