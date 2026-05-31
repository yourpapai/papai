// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gt, isNull } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsAuthCodes } from '../db/schema.js'
import { logger } from '../logger.js'
import { generateToken, hashToken } from './crypto.js'

const log = logger.child({ scope: 'settings:auth-code-store' })

/** One-time code TTL: 10 minutes (spec OQ-A4). */
export const CODE_TTL_MS = 10 * 60 * 1000

export type AuthCodePrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
}

/**
 * Issue a single-use settings code bound to the principal. Supersedes any prior
 * unused codes for the same principal. Returns the plaintext code (only its hash
 * is persisted).
 */
export function issueAuthCode(principal: AuthCodePrincipal, nowMs: number = Date.now()): string {
  const db = getDrizzleDb()
  const code = generateToken()
  const codeHash = hashToken(code)

  db.transaction((tx) => {
    tx.update(settingsAuthCodes)
      .set({ usedAt: nowMs })
      .where(
        and(
          eq(settingsAuthCodes.platformInstanceId, principal.platformInstanceId),
          eq(settingsAuthCodes.platformUserId, principal.platformUserId),
          isNull(settingsAuthCodes.usedAt),
        ),
      )
      .run()

    tx.insert(settingsAuthCodes)
      .values({
        codeHash,
        platformInstanceId: principal.platformInstanceId,
        platformUserId: principal.platformUserId,
        createdAt: nowMs,
        expiresAt: nowMs + CODE_TTL_MS,
        usedAt: null,
      })
      .run()
  })

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Issued settings auth code')
  return code
}

/**
 * Atomically consume a code: marks it used only if it is unused and unexpired.
 * Returns the bound principal, or null on any failure (unknown/expired/used).
 */
export function consumeAuthCode(code: string, nowMs: number = Date.now()): AuthCodePrincipal | null {
  const db = getDrizzleDb()
  const codeHash = hashToken(code)

  const updated = db
    .update(settingsAuthCodes)
    .set({ usedAt: nowMs })
    .where(
      and(
        eq(settingsAuthCodes.codeHash, codeHash),
        isNull(settingsAuthCodes.usedAt),
        gt(settingsAuthCodes.expiresAt, nowMs),
      ),
    )
    .returning({
      platformInstanceId: settingsAuthCodes.platformInstanceId,
      platformUserId: settingsAuthCodes.platformUserId,
    })
    .get()

  if (updated === undefined) {
    log.warn({}, 'Settings auth code rejected')
    return null
  }

  return { platformInstanceId: updated.platformInstanceId, platformUserId: updated.platformUserId }
}
