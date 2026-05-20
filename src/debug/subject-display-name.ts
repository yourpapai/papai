// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inArray } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { users } from '../db/schema.js'

export type SubjectDisplayInput = {
  storageContextId: string
  contextType: string
}

export const resolveDmDisplayNames = (subjects: readonly SubjectDisplayInput[]): Map<string, string | null> => {
  const dmIds = subjects.filter((s) => s.contextType === 'dm').map((s) => s.storageContextId)
  if (dmIds.length === 0) return new Map()
  const rows = getDrizzleDb()
    .select({ id: users.platformUserId, username: users.username })
    .from(users)
    .where(inArray(users.platformUserId, dmIds))
    .all()
  const out = new Map<string, string | null>()
  for (const r of rows) {
    if (r.username !== null) out.set(r.id, r.username)
  }
  return out
}
