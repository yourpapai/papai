// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../db/drizzle.js'
import { systemConfig } from '../../db/schema.js'
import { logger } from '../../logger.js'
import { ANALYTICS_INSTALL_ID_KEY } from '../config.js'

const log = logger.child({ scope: 'analytics-install-id' })

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

let cachedInstallId: string | null = null

export const resetInstallIdCacheForTesting = (): void => {
  cachedInstallId = null
}

function validateUuid(value: string): string {
  const trimmed = value.trim()
  if (!UUID_PATTERN.test(trimmed)) {
    throw new Error(`Malformed analytics install id stored in system_config`)
  }
  return trimmed
}

export function getOrCreateAnalyticsInstallId(): string {
  if (cachedInstallId !== null) return cachedInstallId

  const db = getDrizzleDb()
  const existing = db
    .select()
    .from(systemConfig)
    .where(sql`${systemConfig.key} = ${ANALYTICS_INSTALL_ID_KEY}`)
    .all()

  const found = existing[0]?.value
  if (found !== undefined && found !== '') {
    const valid = validateUuid(found)
    cachedInstallId = valid
    return valid
  }

  const fresh = randomUUID()
  const now = Date.now()
  db.insert(systemConfig)
    .values({ key: ANALYTICS_INSTALL_ID_KEY, value: fresh, updatedAt: now, updatedBy: 'analytics' })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: sql`excluded.value`,
        updatedAt: sql`excluded.updated_at`,
        updatedBy: sql`excluded.updated_by`,
      },
    })
    .run()
  cachedInstallId = fresh
  log.info({ key: ANALYTICS_INSTALL_ID_KEY }, 'analytics install id lazily initialised')
  return fresh
}
