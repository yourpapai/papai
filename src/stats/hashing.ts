// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomBytes } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { systemConfig } from '../db/schema.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'stats-hashing' })

export const STATS_ANONYMITY_SALT_KEY = 'stats_anonymity_salt'

let cachedSalt: string | null = null

export const resetStatsSaltCacheForTesting = (): void => {
  cachedSalt = null
}

export function getStatsAnonymitySalt(): string {
  if (cachedSalt !== null) return cachedSalt

  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(systemConfig)
    .where(sql`${systemConfig.key} = ${STATS_ANONYMITY_SALT_KEY}`)
    .all()

  const found = existing[0]?.value
  if (found !== undefined && found !== '') {
    cachedSalt = found
    return found
  }

  const fresh = randomBytes(32).toString('hex')
  const now = Date.now()
  db.insert(systemConfig)
    .values({ key: STATS_ANONYMITY_SALT_KEY, value: fresh, updatedAt: now, updatedBy: 'stats' })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: { value: sql`excluded.value`, updatedAt: sql`excluded.updated_at`, updatedBy: sql`excluded.updated_by` },
    })
    .run()
  cachedSalt = fresh
  log.info({ key: STATS_ANONYMITY_SALT_KEY }, 'stats anonymity salt lazily initialised')
  return fresh
}

export function keyedHash(input: string): string {
  const salt = getStatsAnonymitySalt()
  return createHash('sha256').update(salt).update('|').update(input).digest('hex')
}
