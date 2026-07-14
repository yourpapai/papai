// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolExecutionOptions } from 'ai'

import type { AuthorizationResult, IncomingMessage, ReplyFn } from './chat/types.js'
import { getPluginConfig } from './config.js'
import { contributionRegistry } from './plugins/contributions.js'
import { getPluginsForContext } from './plugins/registry.js'
import { buildPluginToolRuntimeContext } from './plugins/tool-runtime.js'
import type { PluginManifest, PluginTool, PluginToolRuntimeContext } from './plugins/types.js'

const NO_BOT_MARKER = ':no-bot:'

/** Dependency-injected hooks for {@link maybeRouteCodingTask}, so tests can stub plugin/config lookups. */
export interface CodingModeDeps {
  getMode(configContextId: string): string | null
  nervEligible(configContextId: string): boolean
  getNervContributions(): { manifest: PluginManifest; tools: PluginTool[] } | undefined
  buildRuntime(
    manifest: PluginManifest,
    runtime: { storageContextId: string; chatUserId: string },
  ): PluginToolRuntimeContext
}

const defaultDeps: CodingModeDeps = {
  getMode: (contextId) => getPluginConfig(contextId, 'nerv', 'coding_mode'),
  nervEligible: (contextId) => getPluginsForContext(contextId).some((plugin) => plugin.manifest.id === 'nerv'),
  getNervContributions: () => contributionRegistry.getContributions('nerv'),
  buildRuntime: (manifest, runtime) => buildPluginToolRuntimeContext('nerv', manifest, runtime),
}

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
  if (msg.text.includes(NO_BOT_MARKER)) return false
  if (mode === 'mention_only' && !msg.isMentioned && msg.isReplyToBot !== true) return false
  return true
}

/** Handles the create_coding_task result: conflict reroutes to a followup, other errors are surfaced verbatim. */
async function respondToCreateResult(
  result: unknown,
  msg: IncomingMessage,
  reply: ReplyFn,
  contrib: { tools: PluginTool[] },
  runtimeContext: PluginToolRuntimeContext,
  repoName: string,
): Promise<void> {
  if (isErrorResult(result) && result.error === 'conflict') {
    const followupTool = contrib.tools.find((tool) => tool.name === 'followup_coding_task')
    if (followupTool !== undefined)
      await followupTool.execute({ text: msg.text }, runtimeContext, buildToolExecutionOptions())
    await reply.text('✋ Folded that into the running coding task.')
    return
  }
  if (isErrorResult(result)) {
    await reply.text('⚠️ ' + (result.message ?? 'Could not start a coding task.'))
    return
  }
  await reply.text('🛠️ Started a coding task on `' + repoName + '`.')
}

/**
 * SS-09: for a channel whose `coding_mode` context config is `always`/`mention_only`, deterministically
 * route a qualifying message straight to a coding task, bypassing the LLM entirely.
 *
 * Returns `true` when the message was handled (the caller should return without further processing),
 * or `false` to fall through to normal (LLM) handling. Only single-repo channels are routed; channels
 * with zero or multiple supervised repos fall through (multi-repo routing is deferred to SS-16).
 */
export async function maybeRouteCodingTask(
  msg: IncomingMessage,
  auth: AuthorizationResult,
  reply: ReplyFn,
  deps: CodingModeDeps = defaultDeps,
): Promise<boolean> {
  if (auth.configContextId === undefined) return false
  if (!isRoutableMessage(msg, deps.getMode(auth.configContextId))) return false
  if (!deps.nervEligible(auth.configContextId)) return false

  const contrib = deps.getNervContributions()
  if (contrib === undefined) return false

  const runtimeContext = deps.buildRuntime(contrib.manifest, {
    storageContextId: auth.storageContextId,
    chatUserId: msg.user.id,
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

  const result = await createTool.execute(
    { prompt: msg.text, project: repo.name },
    runtimeContext,
    buildToolExecutionOptions(),
  )
  await respondToCreateResult(result, msg, reply, contrib, runtimeContext, repo.name)
  return true
}
