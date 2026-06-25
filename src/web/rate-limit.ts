// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, lt, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { webRateLimit } from '../db/schema.js'
import { logger } from '../logger.js'
import type { RateLimitResult } from './types.js'

const log = logger.child({ scope: 'web:rate-limit' })

const WINDOW_MS = 5 * 60 * 1000
const LIMIT = 20

/**
 * Generic fixed-window quota primitive backed by the shared `web_rate_limit`
 * table. Each distinct `actorKey` is an independent bucket (the table is keyed
 * by `(actor_id, window_start)`), so callers that want a separate quota pool
 * must namespace their key — e.g. `plugin:<id>:<userId>` — to avoid colliding
 * with the raw web-fetch actor ids consumed by `consumeWebFetchQuota`.
 *
 * Mutating: every allowed call consumes one unit. The name does not imply a
 * read-only peek.
 */
export function consumeQuota(
  actorKey: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): RateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / windowMs) * windowMs
  return db.transaction((tx) => {
    tx.insert(webRateLimit).values({ actorId: actorKey, windowStart, count: 0 }).onConflictDoNothing().run()

    const updated = tx
      .update(webRateLimit)
      .set({ count: sql`${webRateLimit.count} + 1` })
      .where(
        and(
          eq(webRateLimit.actorId, actorKey),
          eq(webRateLimit.windowStart, windowStart),
          lt(webRateLimit.count, limit),
        ),
      )
      .returning({ count: webRateLimit.count })
      .get()

    if (updated !== undefined) {
      const remaining = limit - updated.count
      log.debug({ actorKey, windowStart, count: updated.count, remaining }, 'Consumed quota')
      return { allowed: true, remaining }
    }

    const retryAfterSec = Math.ceil((windowStart + windowMs - nowMs) / 1000)
    const existing = tx
      .select({ count: webRateLimit.count })
      .from(webRateLimit)
      .where(and(eq(webRateLimit.actorId, actorKey), eq(webRateLimit.windowStart, windowStart)))
      .get()

    log.warn({ actorKey, windowStart, count: existing?.count ?? limit, retryAfterSec }, 'Quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  })
}

export function consumeWebFetchQuota(actorId: string, nowMs: number = Date.now()): RateLimitResult {
  return consumeQuota(actorId, LIMIT, WINDOW_MS, nowMs)
}
