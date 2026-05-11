import type { ToolSet } from 'ai'

import { getCachedTools } from '../cache.js'
import { logger } from '../logger.js'
import { buildProviderForUser } from '../providers/factory.js'
import type { TaskProvider } from '../providers/types.js'
import { makeTools } from '../tools/index.js'
import { buildContextToolCatalogPages } from './context-tool-catalog.js'

const log = logger.child({ scope: 'commands:context-tool-resolution' })

export type BuildLiveToolSet = (
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
) => ToolSet | null

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

export function resolveActiveToolDefinitions(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  buildLiveToolSet: BuildLiveToolSet,
): Record<string, unknown> {
  try {
    const liveTools = buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) return toToolRecord(liveTools)
  } catch (error) {
    log.warn(
      {
        storageContextId,
        actorUserId,
        contextType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Live tool definition build failed; falling back to cached tools for context summary',
    )
  }

  return toToolRecord(getCachedTools(storageContextId))
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

export function buildDirectToolCatalogPages(
  storageContextId: string,
  actorUserId: string,
  contextType: 'dm' | 'group',
  provider: TaskProvider | null,
  buildLiveToolSet: BuildLiveToolSet,
): readonly string[] {
  try {
    const liveTools = buildLiveToolSet(storageContextId, actorUserId, contextType, provider)
    if (liveTools !== null) return buildContextToolCatalogPages(liveTools)
  } catch (error) {
    log.warn(
      {
        storageContextId,
        actorUserId,
        contextType,
        error: error instanceof Error ? error.message : String(error),
      },
      'Live tool catalog build failed; falling back to cached tools',
    )
    return buildContextToolCatalogPages(resolveCachedToolSet(storageContextId))
  }

  return buildContextToolCatalogPages(resolveCachedToolSet(storageContextId))
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
