// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextType } from '../chat/types.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { embeddingVersionOf, resolveEmbeddingModel } from './embedding-identity.js'
import { searchHybrid } from './hybrid-search.js'
import { evaluatePromotion } from './promotion.js'
import { resolveMemoryScope } from './scope.js'
import type { MemoryKind, MemoryRecord, MemoryScope, MemoryStatus } from './types.js'

export const RECALL_DEFAULT_LIMIT = 8

export type RecallProvenance = 'current' | 'group' | 'other-thread'
export type RecallHit = MemoryRecord & Readonly<{ provenance: RecallProvenance }>

export type RunRecallCascadeInput = Readonly<{
  storageContextId: string
  configContextId: string
  contextType: ContextType
  query: string
  limit?: number
  kind?: MemoryKind
  includeStale?: boolean
}>

export type RunRecallCascadeDeps = Readonly<{
  getEmbedding: (query: string, configContextId: string) => Promise<readonly number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  schedulePromotion: (record: MemoryRecord, scope: MemoryScope) => void
}>

/** @public -- reused by the shadow recall instrument (Plan 2 T3) for its embedding deps. */
export const defaultDeps: RunRecallCascadeDeps = {
  getEmbedding: (query, configContextId) =>
    getEmbeddingForContext(query, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
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

type ChannelContext = Readonly<{
  scope: MemoryScope
  query: string
  queryEmbedding: readonly number[] | null
  embeddingVersion: string | null
  kind: MemoryKind | undefined
  limit: number
}>

const search = (
  context: ChannelContext,
  statuses: readonly MemoryStatus[],
  threads: Readonly<{ threadContextId?: string; excludeThreadContextId?: string }> = {},
): readonly MemoryRecord[] =>
  searchHybrid({
    ...context.scope,
    query: context.query,
    queryEmbedding: context.queryEmbedding,
    embeddingVersion: context.embeddingVersion,
    statuses,
    kind: context.kind,
    limit: context.limit,
    ...threads,
  })

/** The version identity of the config context issuing this query, or null when it cannot embed. */
const queryEmbeddingVersion = (
  queryEmbedding: readonly number[] | null,
  configContextId: string,
  deps: RunRecallCascadeDeps,
): string | null => {
  if (queryEmbedding === null) return null
  const model = deps.resolveEmbeddingModel(configContextId)
  return model === null ? null : embeddingVersionOf(model, queryEmbedding.length)
}

/** @public -- consumed by the recall tool (Plan 2 T5). */
export async function runRecallCascade(
  input: RunRecallCascadeInput,
  deps: RunRecallCascadeDeps = defaultDeps,
): Promise<{ records: readonly RecallHit[] }> {
  const limit = input.limit ?? RECALL_DEFAULT_LIMIT
  const scope = resolveMemoryScope({ storageContextId: input.storageContextId, contextType: input.contextType })
  const queryEmbedding = await deps.getEmbedding(input.query, input.configContextId)
  const statuses: readonly MemoryStatus[] = input.includeStale === true ? ['active', 'stale'] : ['active']
  const context: ChannelContext = {
    scope,
    query: input.query,
    queryEmbedding,
    embeddingVersion: queryEmbeddingVersion(queryEmbedding, input.configContextId, deps),
    kind: input.kind,
    limit,
  }

  if (input.contextType === 'dm') {
    return { records: dedupe(tag(search(context, statuses), 'group'), limit) }
  }

  const layer1 = search(context, ['provisional'], { threadContextId: input.storageContextId })
  const layer2 = search(context, statuses)
  const combined: RecallHit[] = [...tag(layer1, 'current'), ...tag(layer2, 'group')]

  if (dedupe(combined, limit).length < limit) {
    const siblings = search(context, ['provisional'], { excludeThreadContextId: input.storageContextId })
    for (const record of siblings) deps.schedulePromotion(record, scope)
    combined.push(...tag(siblings, 'other-thread'))
  }

  return { records: dedupe(combined, limit) }
}
