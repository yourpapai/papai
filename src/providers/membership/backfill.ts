// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import pLimit from 'p-limit'

import { getDrizzleDb } from '../../db/drizzle.js'
import { groupMembers } from '../../db/schema.js'
import { logger } from '../../logger.js'
import type { MemberOutcome } from './ensure-member.js'

const log = logger.child({ scope: 'providers:membership:backfill' })

export interface BackfillDeps {
  listAllGroupMembers(): Array<{ groupId: string; userId: string }>
  ensure(groupContextId: string, chatUserId: string): Promise<MemberOutcome>
}

export type BackfillResult = {
  total: number
  created: number
  exists: number
  skipped: number
  failed: number
}

function defaultListAllGroupMembers(): Array<{ groupId: string; userId: string }> {
  const db = getDrizzleDb()
  return db.select({ groupId: groupMembers.groupId, userId: groupMembers.userId }).from(groupMembers).all()
}

/**
 * One-shot idempotent backfill: ensures every existing group member is provisioned.
 * Safe to call on startup and re-run from admin UI.
 */
export async function runMembershipBackfill(deps?: Partial<BackfillDeps>): Promise<BackfillResult> {
  const listFn = deps?.listAllGroupMembers ?? defaultListAllGroupMembers
  const ensureFn = deps?.ensure ?? ((): Promise<MemberOutcome> => Promise.resolve('skipped' as const))

  log.info('Starting membership backfill')
  const members = listFn().filter((m) => !m.userId.startsWith('placeholder-'))
  const result: BackfillResult = { total: members.length, created: 0, exists: 0, skipped: 0, failed: 0 }
  const limit = pLimit(4)

  await Promise.all(
    members.map((m) =>
      limit(async () => {
        const outcome = await ensureFn(m.groupId, m.userId)
        result[outcome]++
      }),
    ),
  )

  log.info(result, 'Membership backfill complete')
  return result
}
