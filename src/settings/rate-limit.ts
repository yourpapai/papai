// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, lt, sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsRateLimit } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'settings:rate-limit' })

export type SettingsRateLimitResult =
  | { readonly allowed: true; readonly remaining: number }
  | { readonly allowed: false; readonly remaining: 0; readonly retryAfterSec: number }

export function consumeSettingsQuota(
  bucket: string,
  actorId: string,
  limit: number,
  windowMs: number,
  nowMs: number = Date.now(),
): SettingsRateLimitResult {
  const db = getDrizzleDb()
  const windowStart = Math.floor(nowMs / windowMs) * windowMs

  return db.transaction((tx) => {
    tx.insert(settingsRateLimit).values({ bucket, actorId, windowStart, count: 0 }).onConflictDoNothing().run()

    const updated = tx
      .update(settingsRateLimit)
      .set({ count: sql`${settingsRateLimit.count} + 1` })
      .where(
        and(
          eq(settingsRateLimit.bucket, bucket),
          eq(settingsRateLimit.actorId, actorId),
          eq(settingsRateLimit.windowStart, windowStart),
          lt(settingsRateLimit.count, limit),
        ),
      )
      .returning({ count: settingsRateLimit.count })
      .get()

    if (updated !== undefined) {
      return { allowed: true, remaining: limit - updated.count }
    }

    const retryAfterSec = Math.ceil((windowStart + windowMs - nowMs) / 1000)
    log.warn({ bucket, actorId, windowStart, retryAfterSec }, 'Settings quota exceeded')
    return { allowed: false, remaining: 0, retryAfterSec }
  })
}
