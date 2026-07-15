// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import { getConfigContextIdFromStorageContextId } from './chat/scoped-context.js'
import type { AuthorizationResult, DeferredDeliveryTarget, IncomingMessage, ReplyFn } from './chat/types.js'
import type { CodingGuardrails } from './coding-credentials/guardrails.js'
import { resolveCodingGuardrails } from './coding-credentials/guardrails.js'
import { getPluginConfig } from './config.js'
import { getRuntimeChatRouter } from './debug/chat-router-runtime.js'
import { contributionRegistry } from './plugins/contributions.js'
import { getPluginsForContext } from './plugins/registry.js'
import { kvSet } from './plugins/store.js'
import { buildPluginToolRuntimeContext } from './plugins/tool-runtime.js'
import type { PluginManifest, PluginTool, PluginToolRuntimeContext } from './plugins/types.js'

const NO_BOT_MARKER = ':no-bot:'
const REACTIONS_KV_PLUGIN_ID = 'nerv-reactions'

/** Dependency-injected hooks for {@link maybeRouteCodingTask}, so tests can stub plugin/config lookups. */
export interface CodingModeDeps {
  getMode(configContextId: string): string | null
  nervEligible(configContextId: string): boolean
  getNervContributions(): { manifest: PluginManifest; tools: PluginTool[] } | undefined
  buildRuntime(
    manifest: PluginManifest,
    runtime: { storageContextId: string; chatUserId: string; messageId?: string },
  ): PluginToolRuntimeContext
  resolveGuardrails(platformInstanceId: string): CodingGuardrails
  /** Instant ack on a successfully-created task: sets `emoji` on `msg.messageId` and records it in
   *  kv so a later notify (P7) can transition/clear it. Best-effort — must never throw. */
  ackReaction(msg: IncomingMessage, auth: AuthorizationResult, emoji: string): Promise<void>
}

/** Builds the delivery target for reacting to `msg` itself (the message just routed), from fields
 *  already on the incoming message — no round-trip through a stored context id needed. */
function buildAckTarget(msg: IncomingMessage, auth: AuthorizationResult): DeferredDeliveryTarget {
  return {
    contextId: msg.contextId,
    contextType: msg.contextType,
    threadId: msg.threadId ?? null,
    audience: 'shared',
    mentionUserIds: [],
    createdByUserId: msg.user.id,
    createdByUsername: null,
    storageContextId: auth.storageContextId,
  }
}

async function defaultAckReaction(msg: IncomingMessage, auth: AuthorizationResult, emoji: string): Promise<void> {
  if (msg.messageId === undefined) return
  const { messageId } = msg
  try {
    const router = getRuntimeChatRouter()
    const ok =
      router === null
        ? false
        : await router.setReaction(msg.platformInstanceId, buildAckTarget(msg, auth), messageId, emoji)
    if (ok) {
      const configContextId = getConfigContextIdFromStorageContextId(auth.storageContextId)
      kvSet(REACTIONS_KV_PLUGIN_ID, configContextId, 'reaction:' + messageId, emoji)
    }
  } catch {
    // Best-effort ack — a failed reaction must never break task creation.
  }
}

const defaultDeps: CodingModeDeps = {
  getMode: (contextId) => getPluginConfig(contextId, 'nerv', 'coding_mode'),
  nervEligible: (contextId) => getPluginsForContext(contextId).some((plugin) => plugin.manifest.id === 'nerv'),
  getNervContributions: () => contributionRegistry.getContributions('nerv'),
  buildRuntime: (manifest, runtime) => buildPluginToolRuntimeContext('nerv', manifest, runtime),
  resolveGuardrails: (platformInstanceId) => resolveCodingGuardrails(platformInstanceId),
  ackReaction: defaultAckReaction,
}

/** Exposes the real `ackReaction` implementation for direct testing — `maybeRouteCodingTask`'s
 *  own tests inject a stub, so the success-gated kv write (P6/defect 3) needs a separate seam. */
export const defaultAckReactionForTest = defaultAckReaction

function buildToolExecutionOptions(): ToolExecutionOptions {
  return { toolCallId: 'coding-mode-router', messages: [] }
}

function isErrorResult(value: unknown): value is { error: string; message?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error: unknown }).error === 'string'
  )
}

/** The `coding_mode` value qualifies this message for routing (mode + no-bot marker + mention gating). */
function isRoutableMessage(msg: IncomingMessage, mode: string | null): mode is 'always' | 'mention_only' {
  if (mode !== 'always' && mode !== 'mention_only') return false
  // Registered commands (e.g. plugin_nerv_nerv) never reach here as commandMatch, but guard anyway;
  // unregistered/typo'd slash commands (e.g. `/nerv`) have no commandMatch and must not become task prompts.
  if (msg.commandMatch !== undefined) return false
  if (msg.text.trimStart().startsWith('/')) return false
  if (msg.text.includes(NO_BOT_MARKER)) return false
  if (mode === 'mention_only' && !msg.isMentioned && msg.isReplyToBot !== true) return false
  return true
}

/**
 * Mirrors the LLM path's guest + who-may-use gate (see `applyGuestReadOnlyFilter` and
 * `applyWhoMayUseFilter` in llm-orchestrator-tools.ts) so a barred actor is never handed a
 * deterministically-created task. Returning `true` here falls through to normal LLM handling,
 * which applies the identical filter and simply creates nothing — same outcome, no bypass.
 */
function isGovernedOut(msg: IncomingMessage, auth: AuthorizationResult, deps: CodingModeDeps): boolean {
  if (auth.isGuest === true) return true
  const { whoMayUse } = deps.resolveGuardrails(msg.platformInstanceId)
  return whoMayUse !== 'members' && !whoMayUse.includes(msg.user.id)
}

/** Per-`storageContextId` async mutex: chains routing work so concurrent messages in one thread
 *  serialize instead of racing the check-then-act `activeTaskConflict` window. */
const contextLocks = new Map<string, Promise<unknown>>()

async function withContextLock<T>(storageContextId: string, fn: () => Promise<T>): Promise<T> {
  const prior = contextLocks.get(storageContextId) ?? Promise.resolve()
  const run = prior.then(fn, fn)
  const guarded = run.catch(() => undefined)
  contextLocks.set(storageContextId, guarded)
  try {
    return await run
  } finally {
    if (contextLocks.get(storageContextId) === guarded) contextLocks.delete(storageContextId)
  }
}

/** Handles the create_coding_task result: conflict reroutes to a followup, other errors are surfaced
 *  verbatim. Returns `true` only for a genuinely successful create, so the caller can fire the
 *  instant ack reaction — a conflict/error never gets one (the existing task keeps its own). */
async function respondToCreateResult(
  result: unknown,
  msg: IncomingMessage,
  reply: ReplyFn,
  contrib: { tools: PluginTool[] },
  runtimeContext: PluginToolRuntimeContext,
  repoName: string,
): Promise<boolean> {
  if (isErrorResult(result) && result.error === 'conflict') {
    const followupTool = contrib.tools.find((tool) => tool.name === 'followup_coding_task')
    if (followupTool !== undefined)
      await followupTool.execute({ text: msg.text }, runtimeContext, buildToolExecutionOptions())
    await reply.text('✋ Folded that into the running coding task.')
    return false
  }
  if (isErrorResult(result)) {
    await reply.text('⚠️ ' + (result.message ?? 'Could not start a coding task.'))
    return false
  }
  await reply.text('🛠️ Started a coding task on `' + repoName + '`.')
  return true
}

/** The repo-resolution-through-create critical section, run inside the per-context lock. Nerv
 *  network errors / bad responses (e.g. `callNerv`'s unguarded JSON.parse) are caught here so the
 *  message is never dropped silently. */
async function routeToCoding(
  msg: IncomingMessage,
  auth: AuthorizationResult,
  reply: ReplyFn,
  deps: CodingModeDeps,
  contrib: { manifest: PluginManifest; tools: PluginTool[] },
): Promise<boolean> {
  const runtimeContext = deps.buildRuntime(contrib.manifest, {
    storageContextId: auth.storageContextId,
    chatUserId: msg.user.id,
    messageId: msg.messageId,
  })

  const repos = runtimeContext.codingRepos.list()
  if (repos.length === 0) {
    await reply.text(
      '🛠️ This channel is in coding mode but has no supervised project configured — add one in Settings → Supervised Projects.',
    )
    return true
  }
  if (repos.length > 1) return false
  const [repo] = repos
  if (repo === undefined) return false

  const createTool = contrib.tools.find((tool) => tool.name === 'create_coding_task')
  if (createTool === undefined) return false

  try {
    const result = await createTool.execute(
      { prompt: msg.text, project: repo.name },
      runtimeContext,
      buildToolExecutionOptions(),
    )
    const created = await respondToCreateResult(result, msg, reply, contrib, runtimeContext, repo.name)
    if (created && msg.messageId !== undefined) await deps.ackReaction(msg, auth, '⏳')
  } catch {
    await reply.text('⚠️ Couldn’t reach the coding service — please try again in a moment.')
  }
  return true
}

/**
 * SS-09: for a channel whose `coding_mode` context config is `always`/`mention_only`, deterministically
 * route a qualifying message straight to a coding task, bypassing the LLM entirely.
 *
 * Returns `true` when the message was handled (the caller should return without further processing),
 * or `false` to fall through to normal (LLM) handling. Only single-repo channels are routed; channels
 * with zero or multiple supervised repos fall through (multi-repo routing is deferred to SS-16).
 */
export function maybeRouteCodingTask(
  msg: IncomingMessage,
  auth: AuthorizationResult,
  reply: ReplyFn,
  deps: CodingModeDeps = defaultDeps,
): Promise<boolean> {
  if (auth.configContextId === undefined) return Promise.resolve(false)
  if (!isRoutableMessage(msg, deps.getMode(auth.configContextId))) return Promise.resolve(false)
  if (!deps.nervEligible(auth.configContextId)) return Promise.resolve(false)
  if (isGovernedOut(msg, auth, deps)) return Promise.resolve(false)

  return withContextLock(auth.storageContextId, () => {
    const contrib = deps.getNervContributions()
    if (contrib === undefined) return Promise.resolve(false)
    return routeToCoding(msg, auth, reply, deps, contrib)
  })
}
