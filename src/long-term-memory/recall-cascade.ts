// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { evaluatePromotion } from './promotion.js'
import { rankCandidatesByQuery } from './recall-ranking.js'
import { resolveMemoryScope } from './scope.js'
import { rankRecordsBySimilarity } from './semantic-search.js'
import { listMemoryRecords, listProvisionalRecords } from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

export const RECALL_DEFAULT_LIMIT = 8

export type RecallProvenance = 'current' | 'group' | 'other-thread'
export type RecallHit = MemoryRecord & Readonly<{ provenance: RecallProvenance }>

export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
}>

export type RunRecallCascadeDeps = Readonly<{
  getEmbedding: (query: string, configContextId: string) => Promise<readonly number[] | null>
  schedulePromotion: (record: MemoryRecord, scope: MemoryScope) => void
}>

const defaultDeps: RunRecallCascadeDeps = {
  getEmbedding: (query, configContextId) =>
    getEmbeddingForContext(query, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  schedulePromotion: (record, scope) => {
    void evaluatePromotion(scope, record)
  },
}

const dedupe = (hits: readonly RecallHit[], limit: number): readonly RecallHit[] => {
  const seen = new Set<string>()
  const out: RecallHit[] = []
  for (const hit of hits) {
    if (seen.has(hit.id)) continue
    seen.add(hit.id)
    out.push(hit)
    if (out.length >= limit) break
  }
  return out
}

const tag = (records: readonly MemoryRecord[], provenance: RecallProvenance): RecallHit[] =>
  records.map((record) => ({ ...record, provenance }))

const searchActiveHybrid = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  limit: number,
): readonly MemoryRecord[] => {
  if (queryEmbedding === null) {
    const active = listMemoryRecords({
      scopeId: scope.scopeId,
      scopeType: scope.scopeType,
      status: 'active',
      limit: 500,
    })
    return rankCandidatesByQuery(active, query, null, { limit })
  }
  const semantic = rankRecordsBySimilarity(scope, queryEmbedding, { statuses: ['active'], limit })
  if (semantic.length > 0) return semantic
  const active = listMemoryRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, status: 'active', limit: 500 })
  return rankCandidatesByQuery(active, query, null, { limit })
}

const scheduleLayerThree = (
  scope: MemoryScope,
  query: string,
  queryEmbedding: readonly number[] | null,
  storageContextId: string,
  limit: number,
  deps: RunRecallCascadeDeps,
): readonly RecallHit[] => {
  const siblings = rankCandidatesByQuery(
    listProvisionalRecords({ ...scope, excludeThreadContextId: storageContextId, limit: 200 }),
    query,
    queryEmbedding,
    { limit },
  )
  for (const record of siblings) deps.schedulePromotion(record, scope)
  return tag(siblings, 'other-thread')
}

/** @public -- consumed by the recall tool (Plan 2 T5). */
export async function runRecallCascade(
  input: RunRecallCascadeInput,
  deps: RunRecallCascadeDeps = defaultDeps,
): Promise<{ records: readonly RecallHit[] }> {
  const limit = input.limit ?? RECALL_DEFAULT_LIMIT
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)

  if (input.contextType === 'dm') {
    return { records: dedupe(tag(searchActiveHybrid(scope, input.query, queryEmbedding, limit), 'group'), limit) }
  }

  const layer1 = rankCandidatesByQuery(
    listProvisionalRecords({ ...scope, threadContextId: input.storageContextId, limit: 100 }),
    input.query,
    queryEmbedding,
    { limit },
  )
  const layer2 = searchActiveHybrid(scope, input.query, queryEmbedding, limit)
  const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

  if (dedupe(combined, limit).length < limit) {
    combined.push(...scheduleLayerThree(scope, input.query, queryEmbedding, input.storageContextId, limit, deps))
  }

  return { records: dedupe(combined, limit) }
}
