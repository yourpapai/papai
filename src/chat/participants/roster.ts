// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'
import pLimit from 'p-limit'

import { getMainContextIdFromThreadContextId } from '../scoped-context.js'
import { getDrizzleDb } from '../../db/drizzle.js'
import { groupMembers, messageMetadata } from '../../db/schema.js'
import { logger } from '../../logger.js'

const log = logger.child({ scope: 'chat:participants:roster' })

const LABEL_RESOLVE_CONCURRENCY = 8
const DEFAULT_LIMIT = 5

export type ResolveUserLabelFn = (userId: string) => Promise<string | null>

export type ParticipantCandidate = {
  userId: string
  displayName: string
  username: string | null
  score: number
}

/** ChatParticipantResolver: injected into the tool, pre-bound to a ResolveUserLabelFn. */
export type ChatParticipantResolver = (
  contextId: string,
  query: string,
  limit?: number,
) => Promise<ParticipantCandidate[]>

type RawCandidate = { userId: string; username: string | null }

/**
 * Gather the union of curated group members and recently-seen senders.
 * Uses the group-level context id (strips thread suffix) for member lookup.
 */
export async function gatherParticipants(contextId: string): Promise<RawCandidate[]> {
  log.debug({ contextId }, 'gatherParticipants')
  const db = getDrizzleDb()
  const groupContextId = getMainContextIdFromThreadContextId(contextId)

  const memberRows = db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupContextId))
    .all()

  const senderRows = db
    .select({
      authorId: messageMetadata.authorId,
      authorUsername: messageMetadata.authorUsername,
    })
    .from(messageMetadata)
    .where(eq(messageMetadata.contextId, contextId))
    .all()

  // Merge: members + senders, deduped by userId.
  const seen = new Map<string, RawCandidate>()
  for (const m of memberRows) {
    seen.set(m.userId, { userId: m.userId, username: null })
  }
  for (const s of senderRows) {
    if (s.authorId === null || s.authorId === undefined) continue
    const existing = seen.get(s.authorId)
    if (existing !== undefined) {
      // prefer username from metadata if available
      if (existing.username === null && s.authorUsername !== null && s.authorUsername !== undefined) {
        seen.set(s.authorId, {
          userId: s.authorId,
          username: s.authorUsername,
        })
      }
    } else {
      seen.set(s.authorId, {
        userId: s.authorId,
        username: s.authorUsername ?? null,
      })
    }
  }

  return Array.from(seen.values())
}

/**
 * Compute a match score for a query against a candidate's display name and username.
 * Returns: 3 = exact, 2 = prefix, 1 = substring, 0 = no match.
 */
export function computeScore(query: string, displayName: string | null, username: string | null): number {
  const q = query.toLowerCase()
  const dn = displayName?.toLowerCase() ?? ''
  const un = username?.toLowerCase() ?? ''

  if (dn === q || un === q) return 3
  if (dn.startsWith(q) || un.startsWith(q)) return 2
  if (dn.includes(q) || un.includes(q)) return 1
  return 0
}

/**
 * Resolve a name query to a ranked list of chat participants.
 * Steps:
 *   1. Gather candidates (group_members ∪ message_metadata senders, deduped).
 *   2. Resolve display names via resolveLabel (p-limited), fall back to username, then userId.
 *   3. Fuzzy-match & rank against query. Return top-N (limit).
 */
export async function resolveChatParticipant(
  contextId: string,
  query: string,
  resolveLabel: ResolveUserLabelFn,
  limit: number = DEFAULT_LIMIT,
): Promise<ParticipantCandidate[]> {
  log.debug({ contextId, query, limit }, 'resolveChatParticipant')
  const raw = await gatherParticipants(contextId)
  if (raw.length === 0) return []

  const limiter = pLimit(LABEL_RESOLVE_CONCURRENCY)
  const resolved: ParticipantCandidate[] = await Promise.all(
    raw.map((candidate) =>
      limiter(async (): Promise<ParticipantCandidate> => {
        let displayName: string
        try {
          const label = await resolveLabel(candidate.userId)
          displayName = label ?? candidate.username ?? candidate.userId
        } catch {
          displayName = candidate.username ?? candidate.userId
        }
        const score = computeScore(query, displayName, candidate.username)
        return {
          userId: candidate.userId,
          displayName,
          username: candidate.username,
          score,
        }
      }),
    ),
  )

  const matched = resolved.filter((c) => c.score > 0)
  matched.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // stable tie-break: alphabetical by userId for determinism
    return a.userId.localeCompare(b.userId)
  })

  const result = matched.slice(0, limit)
  log.info({ contextId, query, count: result.length }, 'resolveChatParticipant completed')
  return result
}
