// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'

import { eq } from 'drizzle-orm'

import { createToken, listTokens, revokeToken, verifyToken } from '../../src/context-vault/token-store.js'
import { contextVaultTokens } from '../../src/db/context-vault-schema.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const CTX_A = 'pi:telegram:grp:a'
const CTX_B = 'pi:telegram:grp:b'

describe('context-vault token-store', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('create returns plaintext once and stores only the SHA-256 hash', () => {
    const created = createToken(CTX_A, 'laptop indexer')

    expect(created.plaintext).toMatch(/^[0-9a-f]{64}$/u)
    expect(created.tokenId).toBeTruthy()

    const row = getDrizzleDb()
      .select()
      .from(contextVaultTokens)
      .where(eq(contextVaultTokens.tokenId, created.tokenId))
      .get()
    expect(row?.tokenHash).toBe(sha256(created.plaintext))
    expect(row?.tokenHash).not.toBe(created.plaintext)
    expect(row?.label).toBe('laptop indexer')
    expect(row?.lastUsedAt).toBeNull()
    expect(row?.revokedAt).toBeNull()
  })

  test('list returns masked tokens without the hash', () => {
    createToken(CTX_A, 'one')
    createToken(CTX_A, 'two')

    const tokens = listTokens(CTX_A)
    expect(tokens).toHaveLength(2)
    for (const token of tokens) {
      expect(token).not.toHaveProperty('tokenHash')
      expect(token).not.toHaveProperty('plaintext')
      expect(token.label).toBeTruthy()
      expect(token.createdAt).toBeGreaterThan(0)
    }
  })

  test('verify resolves a valid plaintext to its config context and updates last_used_at', () => {
    const created = createToken(CTX_A, 'laptop indexer')

    const resolved = verifyToken(created.plaintext)
    expect(resolved).toEqual({ configContextId: CTX_A, tokenId: created.tokenId })

    const row = getDrizzleDb()
      .select()
      .from(contextVaultTokens)
      .where(eq(contextVaultTokens.tokenId, created.tokenId))
      .get()
    expect(row?.lastUsedAt).not.toBeNull()
  })

  test('verify rejects unknown tokens', () => {
    expect(verifyToken('f'.repeat(64))).toBeNull()
  })

  test('revoke marks the token and revoked tokens fail verification', () => {
    const created = createToken(CTX_A, 'laptop indexer')

    expect(revokeToken(CTX_A, created.tokenId)).toBe(true)
    expect(verifyToken(created.plaintext)).toBeNull()

    const listed = listTokens(CTX_A)
    expect(listed[0]?.revokedAt).not.toBeNull()
  })

  test('revoke returns false for an unknown token', () => {
    expect(revokeToken(CTX_A, 'no-such-token')).toBe(false)
  })

  test('tokens are isolated per config context', () => {
    const a = createToken(CTX_A, 'ctx-a token')
    createToken(CTX_B, 'ctx-b token')

    expect(listTokens(CTX_A).map((t) => t.label)).toEqual(['ctx-a token'])
    expect(listTokens(CTX_B).map((t) => t.label)).toEqual(['ctx-b token'])

    expect(revokeToken(CTX_B, a.tokenId)).toBe(false)
    expect(verifyToken(a.plaintext)).toEqual({ configContextId: CTX_A, tokenId: a.tokenId })
  })
})
