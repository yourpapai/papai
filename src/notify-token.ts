// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from './db/drizzle.js'
import { systemConfig } from './db/schema.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'notify-token' })
const NOTIFY_TOKEN_KEY = 'notify_token'

// Cached for the process lifetime; rotating notify_token in the DB requires a bot restart.
let cached: string | null = null

const readFromDb = (): string | null => {
  const row = getDrizzleDb()
    .select({ value: systemConfig.value })
    .from(systemConfig)
    .where(eq(systemConfig.key, NOTIFY_TOKEN_KEY))
    .get()
  return row !== undefined && row.value !== '' ? row.value : null
}

const seedToDb = (value: string): void => {
  getDrizzleDb()
    .insert(systemConfig)
    .values({ key: NOTIFY_TOKEN_KEY, value, updatedAt: Date.now(), updatedBy: 'env' })
    .onConflictDoNothing()
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
  log.info({ key: NOTIFY_TOKEN_KEY }, 'notify_token seeded from env')
  return value
}

export const resetNotifyTokenCacheForTesting = (): void => {
  cached = null
}
