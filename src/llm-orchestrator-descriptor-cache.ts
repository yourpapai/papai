// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ToolSet } from 'ai'

import type { StagedFileDownloadFn } from './attachments/index.js'
import { getCachedTools, setCachedTools } from './cache.js'
import type { ChatParticipantResolver } from './chat/participants/roster.js'
import type { PrepareLlmInvocationDeps } from './llm-orchestrator-tools.js'
import { logger } from './logger.js'
import type { TaskProvider } from './providers/types.js'

const log = logger.child({ scope: 'llm-orchestrator:descriptor-cache' })

const isToolSet = (value: unknown): value is ToolSet =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const getOrCreateDescriptors = async (
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
