// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { memoryRecords } from '../db/schema.js'
import { logger } from '../logger.js'
import { evaluatePromotion } from './promotion.js'
import { listProvisionalRecords } from './store.js'
import type { MemoryRecord, MemoryScope } from './types.js'

const log = logger.child({ scope: 'memory:promotion-sweep' })

export type SweepPromotionsDeps = Readonly<{
  evaluate: (scope: MemoryScope, candidate: MemoryRecord) => Promise<boolean>
  listScopes: () => readonly MemoryScope[]
}>

const defaultListScopes = (): readonly MemoryScope[] => {
  const rows = getDrizzleDb()
    .selectDistinct({ scopeId: memoryRecords.scopeId, scopeType: memoryRecords.scopeType })
    .from(memoryRecords)
    .where(and(eq(memoryRecords.status, 'provisional'), eq(memoryRecords.scopeType, 'group')))
    .all()
  return rows.map((r) => ({ scopeId: r.scopeId, scopeType: r.scopeType }))
}

const defaultDeps: SweepPromotionsDeps = {
  evaluate: (scope, candidate) => evaluatePromotion(scope, candidate),
  listScopes: defaultListScopes,
}

const evaluateCandidate = (scope: MemoryScope, candidate: MemoryRecord, deps: SweepPromotionsDeps): Promise<void> =>
  deps.evaluate(scope, candidate).then(
    () => undefined,
    (error: unknown) => {
      log.warn(
        { recordId: candidate.id, error: error instanceof Error ? error.message : String(error) },
        'Sweep promotion failed',
      )
    },
  )

const sweepScope = (scope: MemoryScope, deps: SweepPromotionsDeps): Promise<void> => {
  const provisional = listProvisionalRecords({ scopeId: scope.scopeId, scopeType: scope.scopeType, limit: 500 })
  const evaluated = new Set<string>()
  const unique = provisional.filter((candidate) => {
    if (evaluated.has(candidate.id)) return false
    evaluated.add(candidate.id)
    return true
  })
  return unique.reduce(
    (chain, candidate) => chain.then(() => evaluateCandidate(scope, candidate, deps)),
    Promise.resolve(),
  )
}

/** Deterministic backstop: evaluate every provisional record for promotion, scope by scope. */
export function sweepPromotions(deps: SweepPromotionsDeps = defaultDeps): Promise<void> {
  const scopes = deps.listScopes()
  return scopes.reduce((chain, scope) => chain.then(() => sweepScope(scope, deps)), Promise.resolve())
}
