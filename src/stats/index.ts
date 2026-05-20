// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { authorizedGroups, llmUsageEvents, users } from '../db/schema.js'
import { resolveDmDisplayNames } from '../debug/subject-display-name.js'
import { distributionsGlobal } from './global-distributions.js'
import { identityMixGlobal, storageGlobal, surfaceMixGlobal } from './global-mix.js'
import { activeSubjectCounts, subjectsGlobal } from './global-subjects.js'
import { toolMixGlobal, webFetchesGlobal } from './global-web-tools.js'
import { attachmentsForSubject, conversationForSubject, messageMetadataForSubject } from './per-table-content.js'
import { groupBlockForSubject, identityForSubject, stagedForSubject, userBlockForSubject } from './per-table-subject.js'
import { llmUsageForSubject, toolCallsForSubject, webFetchesForSubject } from './per-table-usage.js'
import {
  alertsForSubject,
  instructionsForSubject,
  memosForSubject,
  recurringForSubject,
  scheduledForSubject,
} from './per-table.js'
import type { GlobalStats, GlobalStatsOptions, StatsContextType, StatsWindow, SubjectStats } from './types.js'

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  value: GlobalStats
  expiresAt: number
}

const globalCache = new Map<StatsWindow, CacheEntry>()

export function clearStatsCacheForTesting(): void {
  globalCache.clear()
}

function resolveContextType(storageContextId: string): { contextType: StatsContextType; chatUserId: string | null } {
  const userRow = getDrizzleDb()
    .select({ id: users.platformUserId })
    .from(users)
    .where(eq(users.platformUserId, storageContextId))
    .all()
  if (userRow[0] !== undefined) return { contextType: 'dm', chatUserId: storageContextId }

  const groupRow = getDrizzleDb()
    .select({ id: authorizedGroups.groupId })
    .from(authorizedGroups)
    .where(eq(authorizedGroups.groupId, storageContextId))
    .all()
  if (groupRow[0] !== undefined) return { contextType: 'group', chatUserId: null }

  const usageRow = getDrizzleDb()
    .select({ contextType: llmUsageEvents.contextType, chatUserId: llmUsageEvents.chatUserId })
    .from(llmUsageEvents)
    .where(eq(llmUsageEvents.storageContextId, storageContextId))
    .limit(1)
    .all()
  const r = usageRow[0]
  if (r === undefined) return { contextType: 'unknown', chatUserId: null }
  const ct: StatsContextType = r.contextType === 'dm' || r.contextType === 'group' ? r.contextType : 'unknown'
  return { contextType: ct, chatUserId: r.chatUserId }
}

export function getSubjectStats(storageContextId: string): SubjectStats | null {
  const { contextType, chatUserId } = resolveContextType(storageContextId)
  if (contextType === 'unknown') return null

  const displayMap = resolveDmDisplayNames([{ storageContextId, contextType }])
  const displayName = displayMap.get(storageContextId) ?? null

  return {
    storageContextId,
    chatUserId,
    contextType,
    displayName,
    memos: memosForSubject(storageContextId),
    scheduledPrompts: scheduledForSubject(storageContextId),
    alertPrompts: alertsForSubject(storageContextId),
    recurringTasks: recurringForSubject(storageContextId),
    userInstructions: instructionsForSubject(storageContextId),
    attachments: attachmentsForSubject(storageContextId),
    messageMetadata: messageMetadataForSubject(storageContextId),
    conversationHistory: conversationForSubject(storageContextId),
    userIdentityMappings: identityForSubject(storageContextId),
    stagedFiles: stagedForSubject(storageContextId),
    userBlock: contextType === 'dm' ? userBlockForSubject(storageContextId) : null,
    groupBlock: contextType === 'group' ? groupBlockForSubject(storageContextId) : null,
    webFetches: webFetchesForSubject(storageContextId),
    llmUsage: llmUsageForSubject(storageContextId),
    toolCalls: toolCallsForSubject(storageContextId),
  }
}

function computeGlobalStats(window: StatsWindow): GlobalStats {
  return {
    generatedAt: Date.now(),
    window,
    subjects: subjectsGlobal(),
    active: activeSubjectCounts(),
    distributions: distributionsGlobal(),
    storage: storageGlobal(),
    identityMix: identityMixGlobal(),
    surfaceMix: surfaceMixGlobal(),
    webFetches: webFetchesGlobal(),
    toolMix: toolMixGlobal(),
  }
}

export function getGlobalStats(opts: GlobalStatsOptions = {}): GlobalStats {
  const window: StatsWindow = opts.window ?? '30d'
  if (opts.noCache === true) return computeGlobalStats(window)

  const now = Date.now()
  const cached = globalCache.get(window)
  if (cached !== undefined && cached.expiresAt > now) return cached.value

  const fresh = computeGlobalStats(window)
  globalCache.set(window, { value: fresh, expiresAt: now + CACHE_TTL_MS })
  return fresh
}
