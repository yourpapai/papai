// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  VaultTokenCreatedSchema,
  VaultTokensResponseSchema,
  type VaultTokenCreated,
  type VaultTokensResponse,
} from './fetcher-schemas-context-vault.js'
import { ctxQuery, settingsFetch } from './fetchers.js'

// --- Context Vault tokens ---

export const fetchVaultTokens = (contextId: string): Promise<VaultTokensResponse> =>
  settingsFetch(`/settings/api/context-vault/tokens?${ctxQuery(contextId)}`).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return VaultTokensResponseSchema.parse(body)
  })

export const createVaultToken = (input: { contextId: string; label: string }): Promise<VaultTokenCreated> =>
  settingsFetch('/settings/api/context-vault/tokens', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contextId: input.contextId, label: input.label }),
  }).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return VaultTokenCreatedSchema.parse(body)
  })

export const revokeVaultToken = (input: { contextId: string; tokenId: string }): Promise<unknown> =>
  settingsFetch(
    `/settings/api/context-vault/tokens?tokenId=${encodeURIComponent(input.tokenId)}&${ctxQuery(input.contextId)}`,
    { method: 'DELETE' },
  ).then(async (res) => {
    const body = await readBody(res)
    requireOk(res, body)
    return body
  })
