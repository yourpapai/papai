// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import { getDrizzleDb } from '../db/drizzle.js'

let injectedDb: Database | null = null
export const setStoreDb = (db: Database | null): void => {
  injectedDb = db
}
const db = (): Database => injectedDb ?? getDrizzleDb().$client

export interface ClaimInsert {
  nonceHash: string
  adminUserId: string
  platformInstanceId: string
  createdAt: number
  expiresAt: number
}
export interface SessionInsert {
  idHash: string
  adminUserId: string
  issuedAt: number
  expiresAt: number
}
export interface SessionRow {
  adminUserId: string
  expiresAt: number
}

export const insertClaim = (claim: ClaimInsert): void => {
  db()
    .query(
      `INSERT INTO dashboard_claims (nonce_hash, admin_user_id, platform_instance_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(claim.nonceHash, claim.adminUserId, claim.platformInstanceId, claim.createdAt, claim.expiresAt)
}

export const consumeClaimByHash = (nonceHash: string, now: number): { adminUserId: string } | null => {
  const row = db()
    .query<{ admin_user_id: string; expires_at: number; consumed_at: number | null }, [string]>(
      `SELECT admin_user_id, expires_at, consumed_at FROM dashboard_claims WHERE nonce_hash = ?`,
    )
    .get(nonceHash)
  if (row === null) return null
  if (row.consumed_at !== null) return null
  if (row.expires_at <= now) return null
  const result = db()
    .query<{ changes: number }, [number, string]>(
      `UPDATE dashboard_claims SET consumed_at = ? WHERE nonce_hash = ? AND consumed_at IS NULL`,
    )
    .run(now, nonceHash)
  if (result.changes !== 1) return null
  return { adminUserId: row.admin_user_id }
}

export const insertSession = (session: SessionInsert): void => {
  db()
    .query(`INSERT INTO dashboard_sessions (id, admin_user_id, issued_at, expires_at) VALUES (?, ?, ?, ?)`)
    .run(session.idHash, session.adminUserId, session.issuedAt, session.expiresAt)
}

export const loadSessionByHash = (idHash: string, now: number): SessionRow | null => {
  const row = db()
    .query<{ admin_user_id: string; expires_at: number; revoked_at: number | null }, [string]>(
      `SELECT admin_user_id, expires_at, revoked_at FROM dashboard_sessions WHERE id = ?`,
    )
    .get(idHash)
  if (row === null) return null
  if (row.revoked_at !== null) return null
  if (row.expires_at <= now) return null
  return { adminUserId: row.admin_user_id, expiresAt: row.expires_at }
}

export const revokeSessionByHash = (idHash: string, now: number): void => {
  db().query(`UPDATE dashboard_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL`).run(now, idHash)
}

export const touchSession = (idHash: string, now: number, ip: string | null, userAgent: string | null): void => {
  db()
    .query(
      `UPDATE dashboard_sessions SET last_seen_at = ?, last_seen_ip = ?, user_agent = ? WHERE id = ? AND revoked_at IS NULL AND expires_at > ?`,
    )
    .run(now, ip, userAgent, idHash, now)
}

export const deleteExpired = (now: number): void => {
  db().query(`DELETE FROM dashboard_claims WHERE expires_at <= ?`).run(now)
  db().query(`DELETE FROM dashboard_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL`).run(now)
}
