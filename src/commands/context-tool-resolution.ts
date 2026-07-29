// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getCachedTools } from '../cache.js'
import { logger } from '../logger.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import type { TaskProvider } from '../providers/types.js'
import { ALWAYS_ON_TOOL_NAMES } from '../tools/disclosure/core.js'
import { LexicalToolRetriever } from '../tools/disclosure/tool-retriever.js'
import { maybeApplyDisclosure } from '../tools/disclosure/wire.js'
import { applyToolPreferences, buildProviderlessToolDescriptors, makeTools } from '../tools/index.js'

const log = logger.child({ scope: 'commands:context-tool-resolution' })

export type BuildLiveToolSet = (
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
) => Promise<ToolSet | null> | ToolSet | null

export interface ResolvedContextToolSurface {
  definitions: Record<string, unknown>
}

export async function safeBuildProvider(contextId: string): Promise<TaskProvider | null> {
  try {
    return await defaultTaskProviderResolver.resolve(contextId)
  } catch (error) {
    log.warn(
      { contextId, error: error instanceof Error ? error.message : String(error) },
      'Provider unavailable while building context view',
    )
    return null
  }
}

export function resolveActiveToolDefinitions(resolvedToolSurface: ResolvedContextToolSurface): Record<string, unknown> {
  return resolvedToolSurface.definitions
}

/**
 * Context id used only to build the disclosure preview. No real turn is running, so nothing
 * is emitted against it — search_tools/load_tool are constructed for their schemas alone and
 * never executed here.
 */
const DISCLOSURE_PREVIEW_CONTEXT_ID = 'context-view'

/**
 * Narrow the full tool catalog to the surface a live turn's first step actually exposes to
 * the model under progressive disclosure: the always-on core tools plus the injected
 * `search_tools`/`load_tool` meta tools (with their real schemas). This mirrors
 * `maybeApplyDisclosure` + `DisclosureSession.activeToolNames()` in the orchestrator path so
 * the `/context` view counts what a fresh turn loads (~4 tools), not the entire catalog whose
 * schemas only enter context on demand via `load_tool`.
 */
export function resolveDisclosedToolDefinitions(
  resolvedToolSurface: ResolvedContextToolSurface,
): Record<string, unknown> {
  const catalog = resolvedToolSurface.definitions
  try {
    const catalogToolSet: ToolSet = isToolSet(catalog) ? catalog : {}
    const { tools: disclosed, disclosure } = maybeApplyDisclosure(
      catalogToolSet,
      DISCLOSURE_PREVIEW_CONTEXT_ID,
      new LexicalToolRetriever(),
    )
    const active = new Set(disclosure.activeToolNames())
    const definitions: Record<string, unknown> = {}
    for (const [name, definition] of Object.entries(disclosed)) {
      if (active.has(name)) definitions[name] = definition
    }
    return definitions
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to compute disclosed tool surface; falling back to always-on catalog tools',
    )
    const definitions: Record<string, unknown> = {}
    for (const [name, definition] of Object.entries(catalog)) {
      if (ALWAYS_ON_TOOL_NAMES.has(name)) definitions[name] = definition
    }
    return definitions
  }
}

export function buildInvocationToolSet(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
): Promise<ToolSet | null> | ToolSet | null {
  // NOTE: `chatParticipantResolver` is intentionally omitted here.
  // The settings-UI tool surface (which consumes this function) operates outside
  // a live chat turn and has no access to a ChatRouter-bound resolver. As a result,
  // `resolve_chat_participant` is absent from the displayed tool list even when it
  // would be available in a real group turn. This is a known display-only discrepancy
  // — the tool is still exposed correctly during live turns via the orchestrator path.
  if (provider === null) {
    return buildProviderlessToolDescriptors({
      storageContextId,
      chatUserId: actorUserId,
      mode: 'normal',
      contextType,
    }).then((tools) => applyToolPreferences(tools, storageContextId, undefined))
  }

  return makeTools(provider, {
    storageContextId,
    chatUserId: actorUserId,
    mode: 'normal',
    contextType,
  })
}

export async function resolveContextToolSurface(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  buildLiveToolSet: BuildLiveToolSet,
  username?: string | null,
): Promise<ResolvedContextToolSurface> {
  try {
    const liveTools = await buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) {
      return { definitions: toToolRecord(liveTools) }
    }
  } catch (error) {
    log.warn(
      {
        storageContextId,
        actorUserId,
        contextType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Live tool resolution failed; falling back to cached tools',
    )
  }

  return buildDegradedToolSurface(storageContextId, actorUserId, provider, username)
}

function toToolRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, entryValue as unknown]))
}

function isToolSet(value: Record<string, unknown>): value is ToolSet {
  return Object.values(value).every((entry) => typeof entry === 'object' && entry !== null)
}

function buildInvocationCacheKey(
  storageContextId: string,
  actorUserId: string,
  provider: TaskProvider | null,
  username: string | null | undefined,
): string {
  const providerCacheScope = provider === null ? 'providerless' : 'provider-backed'
  const stagedDownloadScope = 'no-staged-download'
  const usernameSuffix = username ?? ''
  return `${providerCacheScope}:${stagedDownloadScope}:${storageContextId}:${actorUserId}:${usernameSuffix}`
}

function resolveCachedToolSet(
  storageContextId: string,
  actorUserId: string,
  provider: TaskProvider | null,
  username: string | null | undefined,
): ToolSet {
  const cachedTools = toToolRecord(
    getCachedTools(buildInvocationCacheKey(storageContextId, actorUserId, provider, username)),
  )
  return isToolSet(cachedTools) ? cachedTools : {}
}

function buildDegradedToolSurface(
  storageContextId: string,
  actorUserId: string,
  provider: TaskProvider | null,
  username: string | null | undefined,
): ResolvedContextToolSurface {
  const cachedTools = applyToolPreferences(
    resolveCachedToolSet(storageContextId, actorUserId, provider, username),
    storageContextId,
    undefined,
  )

  return { definitions: toToolRecord(cachedTools) }
}
