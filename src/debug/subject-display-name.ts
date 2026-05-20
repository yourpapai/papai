// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inArray } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { knownGroupContexts, users } from '../db/schema.js'

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

// Storage context for a thread-scoped group is `${groupId}:${threadId}`.
// known_group_contexts stores the raw `groupId`, so strip the suffix.
const toGroupLookupId = (storageContextId: string): string => {
  const idx = storageContextId.indexOf(':')
  return idx === -1 ? storageContextId : storageContextId.slice(0, idx)
}

export const resolveGroupDisplayNames = (subjects: readonly SubjectDisplayInput[]): Map<string, string | null> => {
  const groupSubjects = subjects.filter((s) => s.contextType === 'group')
  if (groupSubjects.length === 0) return new Map()

  const lookupIds = Array.from(new Set(groupSubjects.map((s) => toGroupLookupId(s.storageContextId))))

  const rows = getDrizzleDb()
    .select({
      contextId: knownGroupContexts.contextId,
      displayName: knownGroupContexts.displayName,
      lastSeenAt: knownGroupContexts.lastSeenAt,
    })
    .from(knownGroupContexts)
    .where(inArray(knownGroupContexts.contextId, lookupIds))
    .all()

  const latestByContext = new Map<string, { displayName: string; lastSeenAt: string }>()
  for (const r of rows) {
    const existing = latestByContext.get(r.contextId)
    if (existing === undefined || r.lastSeenAt > existing.lastSeenAt) {
      latestByContext.set(r.contextId, { displayName: r.displayName, lastSeenAt: r.lastSeenAt })
    }
  }

  const out = new Map<string, string | null>()
  for (const subject of groupSubjects) {
    const lookupId = toGroupLookupId(subject.storageContextId)
    const match = latestByContext.get(lookupId)
    if (match !== undefined) out.set(subject.storageContextId, match.displayName)
  }
  return out
}

export const resolveSubjectDisplayNames = (subjects: readonly SubjectDisplayInput[]): Map<string, string | null> => {
  const merged = new Map<string, string | null>()
  for (const [k, v] of resolveDmDisplayNames(subjects)) merged.set(k, v)
  for (const [k, v] of resolveGroupDisplayNames(subjects)) merged.set(k, v)
  return merged
}
