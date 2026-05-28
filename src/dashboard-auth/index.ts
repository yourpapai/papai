// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import { buildClearCookie, buildSetCookie, readSessionCookie } from './cookie.js'
import {
  consumeClaimByHash,
  deleteExpired,
  insertClaim,
  insertSession,
  loadSessionByHash,
  revokeSessionByHash,
  touchSession,
} from './store.js'

const log = logger.child({ scope: 'dashboard-auth' })

const NONCE_BYTES = 16
const SESSION_BYTES = 32
const DEFAULT_SESSION_TTL = 28_800
const DEFAULT_CLAIM_TTL = 300

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const positiveIntFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  if (!/^\d+$/u.test(raw.trim())) return fallback
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback
  return parsed
}

export const getSessionTtlSeconds = (): number =>
  positiveIntFromEnv('DASHBOARD_SESSION_TTL_SECONDS', DEFAULT_SESSION_TTL)

export const getClaimTtlSeconds = (): number => positiveIntFromEnv('DASHBOARD_CLAIM_TTL_SECONDS', DEFAULT_CLAIM_TTL)

export interface IssuedClaim {
  nonce: string
  expiresAt: number
}

export const issueClaim = (adminUserId: string, platformInstanceId: string): IssuedClaim => {
  const nonce = randomBytes(NONCE_BYTES).toString('hex')
  const now = Date.now()
  const expiresAt = now + getClaimTtlSeconds() * 1000
  insertClaim({ nonceHash: sha256(nonce), adminUserId, platformInstanceId, createdAt: now, expiresAt })
  log.info({ adminUserId, platformInstanceId, expiresAt }, 'issued dashboard claim')
  return { nonce, expiresAt }
}

export const consumeClaim = (nonce: string): { adminUserId: string } | null => {
  if (nonce === '') return null
  return consumeClaimByHash(sha256(nonce), Date.now())
}

export interface MintedSession {
  cookieValue: string
  setCookie: string
  expiresAt: number
}

export const mintSession = (adminUserId: string, opts: { secure: boolean }): MintedSession => {
  const cookieValue = randomBytes(SESSION_BYTES).toString('hex')
  const issuedAt = Date.now()
  const ttlSeconds = getSessionTtlSeconds()
  const expiresAt = issuedAt + ttlSeconds * 1000
  insertSession({ idHash: sha256(cookieValue), adminUserId, issuedAt, expiresAt })
  const setCookie = buildSetCookie({ value: cookieValue, maxAgeSeconds: ttlSeconds, secure: opts.secure })
  log.info({ adminUserId, expiresAt }, 'minted dashboard session')
  return { cookieValue, setCookie, expiresAt }
}

export interface AuthenticatedRequest {
  adminUserId: string
  expiresAt: number
  sessionIdHash: string
}

export const authenticate = (req: Readonly<Request>): AuthenticatedRequest | null => {
  const cookie = readSessionCookie(req)
  if (cookie === null) return null
  const idHash = sha256(cookie)
  const row = loadSessionByHash(idHash, Date.now())
  if (row === null) return null
  return { adminUserId: row.adminUserId, expiresAt: row.expiresAt, sessionIdHash: idHash }
}

export const revokeSession = (cookieValue: string): void => {
  revokeSessionByHash(sha256(cookieValue), Date.now())
}

export const recordActivity = (idHash: string, req: Readonly<Request>): void => {
  const xff = req.headers.get('X-Forwarded-For')
  const ip = xff === null ? null : (xff.split(',')[0]?.trim() ?? '') || null
  const ua = req.headers.get('User-Agent')
  touchSession(idHash, Date.now(), ip, ua)
}

export const sweepExpired = (now: number = Date.now()): void => {
  deleteExpired(now)
}

export { buildClearCookie }
