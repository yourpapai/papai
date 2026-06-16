// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { generateText } from 'ai'

import { resolveEffectiveLlmConfig } from '../llm-config-resolver.js'
import { buildChatModel } from '../llm-model-builder.js'
import { logger } from '../logger.js'
import { cosineSimilarity } from './semantic-search.js'
import {
  archiveMemoryRecord,
  listProvisionalRecords,
  markPromotionRejected,
  promoteProvisionalToActive,
} from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

const log = logger.child({ scope: 'memory:promotion' })

/** @public -- referenced by the promotion sweep (Plan 2 T7). */
export const MEMORY_PROMOTION_MIN_THREADS = 3
const PROMOTION_REJECT_COOLDOWN_MS = 604_800_000
const CLUSTER_SIMILARITY_THRESHOLD = 0.8

export type EvaluatePromotionDeps = Readonly<{
  confirmDurable: (content: string, configContextId: string) => Promise<boolean>
  now: () => string
}>

const isInCooldown = (record: MemoryRecord, now: string): boolean => {
  const rejected = record.evidence.promotionRejectedAt
  if (rejected === undefined) return false
  return new Date(now).getTime() - new Date(rejected).getTime() < PROMOTION_REJECT_COOLDOWN_MS
}

const clusterMembers = (candidate: MemoryRecord, all: readonly MemoryRecord[]): readonly MemoryRecord[] => {
  const vec = candidate.embedding
  return all.filter((other) => {
    if (other.id === candidate.id) return true
    if (vec && other.embedding)
      return cosineSimilarity(Array.from(vec), other.embedding) >= CLUSTER_SIMILARITY_THRESHOLD
    return other.content.trim().toLowerCase() === candidate.content.trim().toLowerCase()
  })
}

const collectThreads = (cluster: readonly MemoryRecord[]): Set<string> => {
  const threads = new Set<string>()
  for (const member of cluster) {
    if (member.threadContextId !== null && member.threadContextId !== undefined) threads.add(member.threadContextId)
    for (const t of member.evidence.threads ?? []) threads.add(t)
  }
  return threads
}

const CONFIRM_PROMPT = (content: string): string =>
  `A fact has been observed independently in several separate group conversations. Decide whether it is a DURABLE, GENERAL fact about this group worth remembering long-term, versus thread-specific or transient noise. Answer with exactly "yes" or "no".\n\nFact: ${content}`

const defaultConfirm = async (content: string, configContextId: string): Promise<boolean> => {
  const resolved = resolveEffectiveLlmConfig(configContextId)
  if (!resolved.ok) return false
  const model = buildChatModel(resolved.llmApiKey, resolved.llmBaseUrl, resolved.smallModel)
  const { text } = await generateText({ model, prompt: CONFIRM_PROMPT(content) })
  return text.trim().toLowerCase().startsWith('yes')
}

const defaultDeps: EvaluatePromotionDeps = {
  confirmDurable: defaultConfirm,
  now: () => new Date().toISOString(),
}

const archiveDuplicates = (scope: MemoryScope, cluster: readonly MemoryRecord[], keepId: string, now: string): void => {
  for (const member of cluster) {
    if (member.id !== keepId) archiveMemoryRecord(scope, member.id, now)
  }
}

/**
 * Evaluate a provisional candidate for promotion to durable group memory.
 * Returns true iff it was promoted. Pure side effects on the store; never throws.
 * @public -- consumed by the recall cascade (T4) + promotion sweep (T7).
 */
export async function evaluatePromotion(
  scope: MemoryScope,
  candidate: MemoryRecord,
  deps: EvaluatePromotionDeps = defaultDeps,
): Promise<boolean> {
  const now = deps.now()
  if (isInCooldown(candidate, now)) return false

  const provisional = listProvisionalRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, limit: 500 })
  const cluster = clusterMembers(candidate, provisional)
  const threads = collectThreads(cluster)
  if (threads.size < MEMORY_PROMOTION_MIN_THREADS) return false

  let confirmed: boolean
  try {
    confirmed = await deps.confirmDurable(candidate.content, candidate.scopeId)
  } catch (error: unknown) {
    log.warn(
      { recordId: candidate.id, error: error instanceof Error ? error.message : String(error) },
      'Promotion confirm failed',
    )
    return false
  }

  if (!confirmed) {
    markPromotionRejected(scope, candidate.id, now)
    return false
  }

  promoteProvisionalToActive(scope, candidate.id, [...threads], now)
  archiveDuplicates(scope, cluster, candidate.id, now)
  log.info({ recordId: candidate.id, threadCount: threads.size }, 'Promoted provisional record to active')
  return true
}
