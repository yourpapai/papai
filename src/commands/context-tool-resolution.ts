// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import { getCachedTools } from '../cache.js'
import { logger } from '../logger.js'
import { buildProviderForUser } from '../providers/factory.js'
import type { TaskProvider } from '../providers/types.js'
import { makeTools } from '../tools/index.js'
import { routeToolsForMessage, type ToolRoutingIntent } from '../tools/tool-router.js'

const log = logger.child({ scope: 'commands:context-tool-resolution' })

export type BuildLiveToolSet = (
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
) => ToolSet | null

export interface ResolvedToolSurfaceRouting {
  intent: ToolRoutingIntent
  fullToolCount: number
  exposedToolCount: number
}

export interface ResolvedContextToolSurface {
  definitions: Record<string, unknown>
  routing?: ResolvedToolSurfaceRouting
}

export function safeBuildProvider(contextId: string): TaskProvider | null {
  try {
    return buildProviderForUser(contextId, false)
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
): ToolSet | null {
  if (provider === null) return null

  return makeTools(provider, {
    storageContextId,
    chatUserId: actorUserId,
    mode: 'normal',
    contextType,
  })
}

export function resolveContextToolSurface(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  buildLiveToolSet: BuildLiveToolSet,
  lastUserText?: string,
): ResolvedContextToolSurface {
  try {
    const liveTools = buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) {
      return applyRoutingIfApplicable(liveTools, lastUserText)
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

  return buildDegradedToolSurface(storageContextId)
}

function applyRoutingIfApplicable(liveTools: ToolSet, lastUserText: string | undefined): ResolvedContextToolSurface {
  if (lastUserText === undefined || lastUserText.trim().length === 0) {
    return { definitions: toToolRecord(liveTools) }
  }
  const routed = routeToolsForMessage(lastUserText, liveTools)
  return {
    definitions: toToolRecord(routed.tools),
    routing: {
      intent: routed.decision.intent,
      fullToolCount: routed.fullToolCount,
      exposedToolCount: routed.exposedToolCount,
    },
  }
}

function toToolRecord(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [key, entryValue as unknown]))
}

function isToolSet(value: Record<string, unknown>): value is ToolSet {
  return Object.values(value).every((entry) => typeof entry === 'object' && entry !== null)
}

function resolveCachedToolSet(contextId: string): ToolSet {
  const cachedTools = toToolRecord(getCachedTools(contextId))
  return isToolSet(cachedTools) ? cachedTools : {}
}

function buildDegradedToolSurface(storageContextId: string): ResolvedContextToolSurface {
  const cachedTools = resolveCachedToolSet(storageContextId)

  return { definitions: toToolRecord(cachedTools) }
}
