// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq, isNull, or, type SQL } from 'drizzle-orm'
import pLimit from 'p-limit'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { getEmbeddingForContext } from '../embeddings.js'
import { logger } from '../logger.js'
import { embeddingVersionOf, resolveEmbeddingModel, UNKNOWN_EMBEDDING_VERSION } from './embedding-identity.js'
import { listContextConfigBindings } from './extraction-state.js'
import { resolveMemoryScope } from './scope.js'
import type { MemoryScopeType } from './types.js'

const log = logger.child({ scope: 'memory:embedding-backfill' })

export type BackfillDeps = Readonly<{
  getEmbedding: (text: string, configContextId: string) => Promise<number[] | null>
  resolveEmbeddingModel: (configContextId: string) => string | null
  now: () => string
  concurrency: number
  batchSize: number
}>

export type BackfillResult = Readonly<{ embedded: number; skipped: number }>

const defaultDeps: BackfillDeps = {
  getEmbedding: (text, configContextId) =>
    getEmbeddingForContext(text, configContextId, {
      storageContextId: configContextId,
      contextType: 'group',
      chatUserId: configContextId,
    }),
  resolveEmbeddingModel,
  now: () => new Date().toISOString(),
  concurrency: 4,
  batchSize: 500,
}

type PendingRow = { id: string; scopeId: string; scopeType: MemoryScopeType; content: string }

const scopeKey = (scopeType: string, scopeId: string): string => `${scopeType}:${scopeId}`

/** scope key -> config context id, derived from the chat contexts bound to each scope. */
const buildScopeConfigMap = (): ReadonlyMap<string, string> => {
  const map = new Map<string, string>()
  for (const binding of listContextConfigBindings()) {
    const scope = resolveMemoryScope({ storageContextId: binding.contextId, contextType: binding.contextType })
    if (!map.has(scopeKey(scope.scopeType, scope.scopeId))) {
      map.set(scopeKey(scope.scopeType, scope.scopeId), binding.configContextId)
    }
  }
  return map
}

const pendingCondition = (): SQL => {
  const condition = or(isNull(memoryRecords.embedding), eq(memoryRecords.embeddingVersion, UNKNOWN_EMBEDDING_VERSION))
  if (condition === undefined) throw new Error('embedding backfill produced an empty predicate')
  return condition
}

const loadPending = (batchSize: number): readonly PendingRow[] =>
  getDrizzleDb()
    .select({
      id: memoryRecords.id,
      scopeId: memoryRecords.scopeId,
      scopeType: memoryRecords.scopeType,
      content: memoryRecords.content,
    })
    .from(memoryRecords)
    .where(pendingCondition())
    .limit(batchSize)
    .all()

const groupByConfigContext = (
  rows: readonly PendingRow[],
  scopeConfig: ReadonlyMap<string, string>,
): { readonly groups: ReadonlyMap<string, readonly PendingRow[]>; readonly unbound: number } => {
  const groups = new Map<string, PendingRow[]>()
  let unbound = 0
  for (const row of rows) {
    const configContextId = scopeConfig.get(scopeKey(row.scopeType, row.scopeId))
    if (configContextId === undefined) {
      unbound += 1
      continue
    }
    const bucket = groups.get(configContextId)
    if (bucket === undefined) groups.set(configContextId, [row])
    else bucket.push(row)
  }
  return { groups, unbound }
}

// One row, one transaction: a crash mid-sweep leaves every earlier row done.
const checkpoint = (row: PendingRow, embedding: number[], model: string, now: string): void => {
  getDrizzleDb()
    .update(memoryRecords)
    .set({
      embedding: Buffer.from(new Float32Array(embedding).buffer),
      embeddingModel: model,
      embeddingDimension: embedding.length,
      embeddingVersion: embeddingVersionOf(model, embedding.length),
      embeddedAt: now,
    })
    .where(eq(memoryRecords.id, row.id))
    .run()
}

const backfillGroup = async (
  configContextId: string,
  rows: readonly PendingRow[],
  deps: BackfillDeps,
): Promise<BackfillResult> => {
  const model = deps.resolveEmbeddingModel(configContextId)
  if (model === null) {
    log.warn({ configContextId, pending: rows.length }, 'No embedding model; skipping context this sweep')
    return { embedded: 0, skipped: rows.length }
  }

  const limit = pLimit(deps.concurrency)
  const outcomes = await Promise.all(
    rows.map((row) =>
      limit(async (): Promise<boolean> => {
        try {
          const embedding = await deps.getEmbedding(row.content, configContextId)
          if (embedding === null) return false
          checkpoint(row, embedding, model, deps.now())
          return true
        } catch (error) {
          log.warn(
            { recordId: row.id, error: error instanceof Error ? error.message : String(error) },
            'Backfill embedding failed; record stays lexical-only',
          )
          return false
        }
      }),
    ),
  )

  const embedded = outcomes.filter(Boolean).length
  return { embedded, skipped: rows.length - embedded }
}

/**
 * Embeds and stamps records that have no vector or a pre-identity vector.
 * Grouped by config context so BYOK credentials resolve correctly, bounded by
 * p-limit, and checkpointed per row so a restart resumes rather than restarts.
 * Rows awaiting backfill stay fully retrievable through the lexical channel.
 * @public -- registered as a scheduler task.
 */
export async function runEmbeddingBackfill(overrides: Partial<BackfillDeps> = {}): Promise<BackfillResult> {
  const deps: BackfillDeps = { ...defaultDeps, ...overrides }
  const pending = loadPending(deps.batchSize)
  if (pending.length === 0) return { embedded: 0, skipped: 0 }

  const { groups, unbound } = groupByConfigContext(pending, buildScopeConfigMap())
  if (unbound > 0) log.warn({ unbound }, 'Records in scopes with no config-context binding; skipped')

  // Groups run sequentially (chained via reduce, not a for-loop await) so the
  // sweep never fans out across every context at once.
  const totals = await [...groups.entries()].reduce<Promise<BackfillResult>>(
    async (chain, [configContextId, rows]) => {
      const acc = await chain
      const result = await backfillGroup(configContextId, rows, deps)
      return { embedded: acc.embedded + result.embedded, skipped: acc.skipped + result.skipped }
    },
    Promise.resolve({ embedded: 0, skipped: unbound }),
  )

  log.info({ ...totals, pending: pending.length }, 'Embedding backfill sweep complete')
  return totals
}
