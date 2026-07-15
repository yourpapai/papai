// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LlmRoleBindings, Verification } from './fetcher-schemas-llm-providers.js'
import { writeJson } from './fetchers.js'

/** Shape matching the server's ProviderInBlobSchema (plaintext apiKey, full verification). */
type ByokProviderEntry = {
  id: string
  label: string
  providerType: string
  baseUrl: string
  apiKey: string
  verification: Verification
}

export const upsertByokProviderAction = (input: { contextId: string; provider: ByokProviderEntry }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'upsert-provider', provider: input.provider },
    (b) => b,
  )

export const deleteByokProviderAction = (input: { contextId: string; id: string }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'delete-provider', id: input.id },
    (b) => b,
  )

export const setByokRolesAction = (input: { contextId: string; roles: LlmRoleBindings }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'set-roles', roles: input.roles },
    (b) => b,
  )

export const refreshByokModels = (input: { contextId: string; id: string }): Promise<unknown> =>
  writeJson(
    '/settings/api/byok',
    'PATCH',
    { contextId: input.contextId, action: 'refresh-models', id: input.id },
    (b) => b,
  )
