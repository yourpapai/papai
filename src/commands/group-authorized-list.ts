// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { listAuthorizedGroups } from '../authorized-groups.js'
import { resolveChatGroupDisplayLabel, resolveChatUserDisplayLabel } from '../chat/group-display-resolution.js'
import { getNativeContextId, parseScopedContextId } from '../chat/scoped-context.js'
import { resolveSourceChatProvider } from '../chat/source-instance.js'
import type { ChatProvider, ResolveUserContext } from '../chat/types.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'commands:group' })
const MAX_CONCURRENT_LABEL_LOOKUPS = 5

type LabelResolverContext = {
  readonly chat: ChatProvider
  readonly contextId: string
  readonly contextType: 'dm' | 'group'
  readonly platformInstanceId: string | undefined
}

type ScheduleLookup = (lookup: () => Promise<string | null>) => Promise<string | null>

const makeDisplayLabel = (label: string | null, fallback: string): string => {
  if (label === null) return fallback
  return label
}

const cacheScope = (platformInstanceId: string | undefined): string => {
  if (platformInstanceId === undefined) return 'native'
  return platformInstanceId
}

const resolveUserContextForLabelLookup = (resolverContext: LabelResolverContext): ResolveUserContext => {
  if (resolverContext.platformInstanceId === undefined) {
    return { contextId: resolverContext.contextId, contextType: resolverContext.contextType }
  }
  return {
    contextId: resolverContext.contextId,
    contextType: resolverContext.contextType,
    platformInstanceId: resolverContext.platformInstanceId,
  }
}

const resolveUserLabelCached = (
  resolverContext: LabelResolverContext,
  userId: string,
  cache: Map<string, Promise<string | null>>,
  scheduleLookup: ScheduleLookup,
): Promise<string | null> => {
  const cacheKey = `${cacheScope(resolverContext.platformInstanceId)}:${resolverContext.contextType}:${resolverContext.contextId}:${userId}`
  const existing = cache.get(cacheKey)
  if (existing !== undefined) return existing
  const pending = scheduleLookup(() =>
    resolveChatUserDisplayLabel(resolverContext.chat, userId, resolveUserContextForLabelLookup(resolverContext)).catch(
      (error: unknown): string | null => {
        log.warn(
          {
            userId,
            contextId: resolverContext.contextId,
            contextType: resolverContext.contextType,
            error: error instanceof Error ? error.message : String(error),
          },
          'User label lookup failed in group command',
        )
        return null
      },
    ),
  )

  cache.set(cacheKey, pending)
  return pending
}

const resolveGroupLabelCached = (
  chat: ChatProvider,
  groupId: string,
  platformInstanceId: string | undefined,
  cache: Map<string, Promise<string | null>>,
  scheduleLookup: ScheduleLookup,
): Promise<string | null> => {
  const cacheKey = `${cacheScope(platformInstanceId)}:${groupId}`
  const existing = cache.get(cacheKey)
  if (existing !== undefined) return existing
  const pending = scheduleLookup(() =>
    resolveChatGroupDisplayLabel(chat, groupId, platformInstanceId).catch((error: unknown): string | null => {
      log.warn({ groupId, error: error instanceof Error ? error.message : String(error) }, 'Group label lookup failed in group command')
      return null
    }),
  )
  cache.set(cacheKey, pending)
  return pending
}

const getOptionalGroupPlatformInstanceId = (groupId: string): string | undefined => {
  const parsed = parseScopedContextId(groupId)
  if (parsed === null) return undefined
  return parsed.platformInstanceId
}

export const listAuthorizedGroupDisplayLines = (chat: ChatProvider): Promise<readonly string[]> => {
  const groupLabelCache = new Map<string, Promise<string | null>>()
  const userLabelCache = new Map<string, Promise<string | null>>()
  const limit = pLimit(MAX_CONCURRENT_LABEL_LOOKUPS)

  return Promise.all(
    listAuthorizedGroups().map(async (group) => {
      const nativeGroupId = getNativeContextId(group.group_id)
      const groupPlatformInstanceId = getOptionalGroupPlatformInstanceId(group.group_id)
      const labelProvider = groupPlatformInstanceId === undefined ? chat : resolveSourceChatProvider(chat, groupPlatformInstanceId)
      const [resolvedGroupLabel, resolvedUserLabel] = await Promise.all([
        resolveGroupLabelCached(labelProvider, nativeGroupId, groupPlatformInstanceId, groupLabelCache, limit),
        resolveUserLabelCached(
          { chat, contextId: nativeGroupId, contextType: 'group', platformInstanceId: groupPlatformInstanceId },
          group.added_by,
          userLabelCache,
          limit,
        ),
      ])

      const groupLabel = makeDisplayLabel(resolvedGroupLabel, nativeGroupId)
      const userLabel = makeDisplayLabel(resolvedUserLabel, group.added_by)
      return `${groupLabel} (added by ${userLabel})`
    }),
  )
}
