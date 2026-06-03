// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getCachedTools } from '../cache.js'
import { logger } from '../logger.js'
import { defaultTaskProviderResolver } from '../providers/resolver.js'
import type { TaskProvider } from '../providers/types.js'
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

export function buildInvocationToolSet(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
): Promise<ToolSet | null> | ToolSet | null {
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
