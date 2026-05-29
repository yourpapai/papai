// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { and, eq, gt } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { settingsSessions } from '../db/schema.js'
import { logger } from '../logger.js'
import { generateToken, hashToken } from './crypto.js'

const log = logger.child({ scope: 'settings:session-store' })

/** Session TTL: 60 minutes sliding (spec OQ-A4). */
export const SESSION_TTL_MS = 60 * 60 * 1000

export type SessionPrincipal = {
  readonly platformInstanceId: string
  readonly platformUserId: string
}

export type CreatedSession = {
  readonly sessionId: string
  readonly csrfToken: string
  readonly expiresAt: number
}

export type SessionRecord = {
  readonly platformInstanceId: string
  readonly platformUserId: string
  readonly csrfTokenHash: string
  readonly expiresAt: number
}

export function createSession(principal: SessionPrincipal, nowMs: number = Date.now()): CreatedSession {
  const db = getDrizzleDb()
  const sessionId = generateToken()
  const csrfToken = generateToken()
  const expiresAt = nowMs + SESSION_TTL_MS

  db.insert(settingsSessions)
    .values({
      sessionIdHash: hashToken(sessionId),
      platformInstanceId: principal.platformInstanceId,
      platformUserId: principal.platformUserId,
      createdAt: nowMs,
      expiresAt,
      csrfTokenHash: hashToken(csrfToken),
    })
    .run()

  log.info({ platformInstanceId: principal.platformInstanceId }, 'Created settings session')
  return { sessionId, csrfToken, expiresAt }
}

/** Look up a session by plaintext id, sliding its expiry. Deletes & rejects if expired. */
export function getSession(sessionId: string, nowMs: number = Date.now()): SessionRecord | null {
  const db = getDrizzleDb()
  const sessionIdHash = hashToken(sessionId)

  return db.transaction((tx) => {
    const row = tx.select().from(settingsSessions).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).get()
    if (row === undefined) return null

    if (row.expiresAt <= nowMs) {
      tx.delete(settingsSessions).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).run()
      return null
    }

    const expiresAt = nowMs + SESSION_TTL_MS
    tx.update(settingsSessions).set({ expiresAt }).where(eq(settingsSessions.sessionIdHash, sessionIdHash)).run()

    return {
      platformInstanceId: row.platformInstanceId,
      platformUserId: row.platformUserId,
      csrfTokenHash: row.csrfTokenHash,
      expiresAt,
    }
  })
}

/** Issue a fresh CSRF token for an existing session, returning the plaintext. */
export function rotateSessionCsrf(sessionId: string, nowMs: number = Date.now()): string | null {
  const db = getDrizzleDb()
  const sessionIdHash = hashToken(sessionId)
  const csrfToken = generateToken()

  const updated = db
    .update(settingsSessions)
    .set({ csrfTokenHash: hashToken(csrfToken), expiresAt: nowMs + SESSION_TTL_MS })
    .where(and(eq(settingsSessions.sessionIdHash, sessionIdHash), gt(settingsSessions.expiresAt, nowMs)))
    .returning({ sessionIdHash: settingsSessions.sessionIdHash })
    .get()

  if (updated === undefined) {
    log.warn({}, 'CSRF rotation rejected: session missing or expired')
    return null
  }
  return csrfToken
}

export function deleteSession(sessionId: string): void {
  const db = getDrizzleDb()
  db.delete(settingsSessions)
    .where(eq(settingsSessions.sessionIdHash, hashToken(sessionId)))
    .run()
}

export function deleteSessionsForPrincipal(platformInstanceId: string, platformUserId: string): number {
  const db = getDrizzleDb()
  const rows = db
    .delete(settingsSessions)
    .where(
      and(
        eq(settingsSessions.platformInstanceId, platformInstanceId),
        eq(settingsSessions.platformUserId, platformUserId),
      ),
    )
    .returning({ sessionIdHash: settingsSessions.sessionIdHash })
    .all()
  return rows.length
}
