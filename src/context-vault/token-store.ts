// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import { and, eq, isNull } from 'drizzle-orm'

import { contextVaultTokens } from '../db/context-vault-schema.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'context-vault:token-store' })

export interface CreatedToken {
  tokenId: string
  plaintext: string
  createdAt: number
}

export interface ListedToken {
  tokenId: string
  label: string
  createdAt: number
  lastUsedAt: number | null
  revokedAt: number | null
}

export interface VerifiedToken {
  configContextId: string
  tokenId: string
}

const hashToken = (plaintext: string): string => createHash('sha256').update(plaintext).digest('hex')

const hashesEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA)
    return false
  }
  return timingSafeEqual(bufA, bufB)
}

export function createToken(configContextId: string, label: string): CreatedToken {
  const plaintext = randomBytes(32).toString('hex')
  const created: CreatedToken = { tokenId: randomUUID(), plaintext, createdAt: Date.now() }
  getDrizzleDb()
    .insert(contextVaultTokens)
    .values({
      configContextId,
      tokenId: created.tokenId,
      label,
      tokenHash: hashToken(plaintext),
      createdAt: created.createdAt,
    })
    .run()
  log.info({ configContextId, tokenId: created.tokenId, label }, 'Context vault token created')
  return created
}

export function listTokens(configContextId: string): ListedToken[] {
  return getDrizzleDb()
    .select({
      tokenId: contextVaultTokens.tokenId,
      label: contextVaultTokens.label,
      createdAt: contextVaultTokens.createdAt,
      lastUsedAt: contextVaultTokens.lastUsedAt,
      revokedAt: contextVaultTokens.revokedAt,
    })
    .from(contextVaultTokens)
    .where(eq(contextVaultTokens.configContextId, configContextId))
    .all()
}

export function revokeToken(configContextId: string, tokenId: string): boolean {
  const existing = getDrizzleDb()
    .select({ tokenId: contextVaultTokens.tokenId })
    .from(contextVaultTokens)
    .where(
      and(
        eq(contextVaultTokens.configContextId, configContextId),
        eq(contextVaultTokens.tokenId, tokenId),
        isNull(contextVaultTokens.revokedAt),
      ),
    )
    .get()
  if (existing === undefined) {
    log.warn({ configContextId, tokenId }, 'Context vault token revoke matched no active token')
    return false
  }
  getDrizzleDb()
    .update(contextVaultTokens)
    .set({ revokedAt: Date.now() })
    .where(and(eq(contextVaultTokens.configContextId, configContextId), eq(contextVaultTokens.tokenId, tokenId)))
    .run()
  log.info({ configContextId, tokenId }, 'Context vault token revoked')
  return true
}

const touchLastUsed = (configContextId: string, tokenId: string): void => {
  try {
    getDrizzleDb()
      .update(contextVaultTokens)
      .set({ lastUsedAt: Date.now() })
      .where(and(eq(contextVaultTokens.configContextId, configContextId), eq(contextVaultTokens.tokenId, tokenId)))
      .run()
  } catch (error) {
    log.warn(
      { configContextId, tokenId, error: error instanceof Error ? error.message : String(error) },
      'Failed to update context vault token last_used_at',
    )
  }
}

const DUMMY_HASH = hashToken('')

export function verifyToken(plaintext: string): VerifiedToken | null {
  const presentedHash = hashToken(plaintext)
  const row = getDrizzleDb()
    .select()
    .from(contextVaultTokens)
    .where(and(eq(contextVaultTokens.tokenHash, presentedHash), isNull(contextVaultTokens.revokedAt)))
    .get()
  if (row === undefined || !hashesEqual(row.tokenHash, presentedHash)) {
    hashesEqual(presentedHash, DUMMY_HASH)
    log.warn('Context vault token verification failed')
    return null
  }
  touchLastUsed(row.configContextId, row.tokenId)
  return { configContextId: row.configContextId, tokenId: row.tokenId }
}
