// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Context Vault tokens ---

export const VaultTokenRecordSchema = z.object({
  tokenId: z.string(),
  label: z.string(),
  createdAt: z.number(),
  lastUsedAt: z.number().nullable(),
  revokedAt: z.number().nullable(),
})
export type VaultTokenRecord = z.infer<typeof VaultTokenRecordSchema>
export const VaultTokensResponseSchema = z.object({ tokens: z.array(VaultTokenRecordSchema) })
export type VaultTokensResponse = z.infer<typeof VaultTokensResponseSchema>

export const VaultTokenCreatedSchema = z.object({
  ok: z.literal(true),
  tokenId: z.string(),
  plaintext: z.string(),
  contextId: z.string(),
})
export type VaultTokenCreated = z.infer<typeof VaultTokenCreatedSchema>
