// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { inArray } from 'drizzle-orm'

import { analyticsPolicyAudit } from '../../db/schema.js'
import type { AnalyticsPreferenceRow } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { upsertPreferenceRowInTx } from './preference-row.js'
import type { PreferenceTx } from './preference-row.js'
import type { PreferenceSource } from './preference-types.js'

const log = logger.child({ scope: 'analytics:governance:preference-lifecycle' })

export const upsertPreferenceDenyInTx = (
  tx: PreferenceTx,
  input: Readonly<{
    governanceActorKey: string
    keyVersion: string
    policyVersion: number
    source: PreferenceSource
    nowMs: number
  }>,
): AnalyticsPreferenceRow =>
  upsertPreferenceRowInTx(tx, {
    governanceActorKey: input.governanceActorKey,
    keyVersion: input.keyVersion,
    policyVersion: input.policyVersion,
    source: input.source,
    nowMs: input.nowMs,
    apply: () => ({ localLongitudinal: 'deny', externalPseudonymous: 'deny' }),
  })

export const appendPolicyAuditInTx = (
  tx: PreferenceTx,
  input: Readonly<{
    governanceActorKey: string
    action: 'allow' | 'deny' | 'withdraw' | 'delete_requested' | 'delete_completed'
    policyVersion: number
    nowMs: number
  }>,
): string => {
  const auditId = randomUUID()
  tx.insert(analyticsPolicyAudit)
    .values({
      auditId,
      governanceActorKey: input.governanceActorKey,
      action: input.action,
      policyVersion: input.policyVersion,
      occurredAt: input.nowMs,
      result: 'applied',
      failureClass: null,
    })
    .run()
  return auditId
}

export const purgeSupersededAuditIn = (
  tx: PreferenceTx,
  input: Readonly<{ nowMs: number; deadlineFor: (occurredAtMs: number) => number }>,
): number => {
  const rows = tx
    .select({
      auditId: analyticsPolicyAudit.auditId,
      governanceActorKey: analyticsPolicyAudit.governanceActorKey,
      occurredAt: analyticsPolicyAudit.occurredAt,
    })
    .from(analyticsPolicyAudit)
    .all()
  const latestByActor = new Map<string, number>()
  for (const row of rows) {
    const latest = latestByActor.get(row.governanceActorKey)
    if (latest === undefined || row.occurredAt > latest) latestByActor.set(row.governanceActorKey, row.occurredAt)
  }
  const expiredIds = rows
    .filter(
      (row) =>
        row.occurredAt < (latestByActor.get(row.governanceActorKey) ?? 0) &&
        input.deadlineFor(row.occurredAt) <= input.nowMs,
    )
    .map((row) => row.auditId)
  if (expiredIds.length === 0) return 0
  tx.delete(analyticsPolicyAudit).where(inArray(analyticsPolicyAudit.auditId, expiredIds)).run()
  log.info({ count: expiredIds.length }, 'superseded governance audit rows purged')
  return expiredIds.length
}
