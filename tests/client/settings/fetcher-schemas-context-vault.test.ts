// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  VaultTokenCreatedSchema,
  VaultTokenRecordSchema,
  VaultTokensResponseSchema,
} from '../../../client/settings/fetcher-schemas-context-vault.js'

describe('fetcher-schemas-context-vault', () => {
  test('VaultTokenRecordSchema parses a listed token', () => {
    const result = VaultTokenRecordSchema.parse({
      tokenId: 't1',
      label: 'laptop indexer',
      createdAt: 1700000000000,
      lastUsedAt: null,
      revokedAt: null,
    })
    expect(result.tokenId).toBe('t1')
    expect(result.lastUsedAt).toBeNull()
  })

  test('VaultTokensResponseSchema parses the tokens array', () => {
    const result = VaultTokensResponseSchema.parse({
      tokens: [{ tokenId: 't1', label: 'ci', createdAt: 1, lastUsedAt: 2, revokedAt: null }],
    })
    expect(result.tokens).toHaveLength(1)
  })

  test('VaultTokensResponseSchema parses an empty tokens array', () => {
    expect(VaultTokensResponseSchema.parse({ tokens: [] }).tokens).toHaveLength(0)
  })

  test('VaultTokenRecordSchema rejects missing required fields', () => {
    expect(() => VaultTokenRecordSchema.parse({ tokenId: 't1' })).toThrow()
  })

  test('VaultTokenCreatedSchema parses the plaintext-once create response', () => {
    const result = VaultTokenCreatedSchema.parse({
      ok: true,
      tokenId: 't-new',
      plaintext: 'cv-secret',
      contextId: 'pi:telegram:ctx:u1',
    })
    expect(result.plaintext).toBe('cv-secret')
  })

  test('VaultTokenCreatedSchema rejects a response without plaintext', () => {
    expect(() => VaultTokenCreatedSchema.parse({ ok: true, tokenId: 't-new', contextId: 'c' })).toThrow()
  })
})
