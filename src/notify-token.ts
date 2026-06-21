// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { systemConfig } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'notify-token' })
const NOTIFY_TOKEN_KEY = 'notify_token'

let cached: string | null = null

const readFromDb = (): string | null => {
  const rows = getDrizzleDb()
    .select()
    .from(systemConfig)
    .where(sql`${systemConfig.key} = ${NOTIFY_TOKEN_KEY}`)
    .all()
  const found = rows[0]?.value
  return found !== undefined && found !== '' ? found : null
}

const seedToDb = (value: string): void => {
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: NOTIFY_TOKEN_KEY, value, updatedAt: Date.now(), updatedBy: 'env' })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
}

export const getNotifyToken = (): string | null => {
  if (cached !== null) return cached
  const existing = readFromDb()
  if (existing !== null) {
    cached = existing
    return existing
  }
  const env = process.env['NOTIFY_TOKEN']
  if (env === undefined || env.trim() === '') return null
  const value = env.trim()
  seedToDb(value)
  cached = value
  log.info('notify_token seeded from env')
  return value
}

export const resetNotifyTokenCacheForTesting = (): void => {
  cached = null
}
