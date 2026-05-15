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

export function consumeWebFetchQuota(actorId: string, nowMs: number = Date.now()): RateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / WINDOW_MS) * WINDOW_MS
  return db.transaction((tx) => {
    tx.insert(webRateLimit).values({ actorId, windowStart, count: 0 }).onConflictDoNothing().run()

    const updated = tx
      .update(webRateLimit)
      .set({ count: sql`${webRateLimit.count} + 1` })
      .where(
        and(
          eq(webRateLimit.actorId, actorId),
          eq(webRateLimit.windowStart, windowStart),
          lt(webRateLimit.count, LIMIT),
        ),
      )
      .returning({ count: webRateLimit.count })
      .get()

    if (updated !== undefined) {
      const remaining = LIMIT - updated.count

      log.info({ actorId, windowStart, count: updated.count, remaining }, 'Consumed web fetch quota')
      return { allowed: true, remaining }
    }

    const retryAfterSec = Math.ceil((windowStart + WINDOW_MS - nowMs) / 1000)
    const existing = tx
      .select({ count: webRateLimit.count })
      .from(webRateLimit)
      .where(and(eq(webRateLimit.actorId, actorId), eq(webRateLimit.windowStart, windowStart)))
      .get()

    log.warn({ actorId, windowStart, count: existing?.count ?? LIMIT, retryAfterSec }, 'Web fetch quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  })
}
