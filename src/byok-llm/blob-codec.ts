// src/byok-llm/blob-codec.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LlmProviderAccount, LlmRoleBindings, RoleBinding, Verification } from '../llm-providers/types.js'

export type ByokProvider = LlmProviderAccount
export type ByokRoles = LlmRoleBindings
export type ByokBlobV2 = {
  readonly v: 2
  readonly providers: readonly ByokProvider[]
  readonly roles: ByokRoles
}

type LegacyBlob = Partial<
  Record<'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model', string>
>

const isV2 = (value: unknown): value is ByokBlobV2 =>
  typeof value === 'object' && value !== null && 'v' in value && value.v === 2

const isLegacy = (value: unknown): value is LegacyBlob =>
  typeof value === 'object' && value !== null && 'llm_apikey' in value

const emptyVerification = (): Verification => ({
  status: 'unverified',
  error: null,
  at: null,
  models: [],
  modelsFetchedAt: null,
})

const fromLegacy = (legacy: LegacyBlob): ByokBlobV2 => {
  const id = 'prov_legacy'
  const provider: ByokProvider = {
    id,
    label: 'Migrated BYOK provider',
    providerType: 'custom',
    baseUrl: legacy['llm_baseurl'] ?? '',
    apiKey: legacy['llm_apikey'] ?? '',
    verification: emptyVerification(),
  }
  const smallModel = legacy['small_model']
  const embeddingModel = legacy['embedding_model']
  const small: RoleBinding = smallModel === undefined ? null : { providerId: id, model: smallModel }
  const embedding: RoleBinding = embeddingModel === undefined ? null : { providerId: id, model: embeddingModel }
  return {
    v: 2,
    providers: [provider],
    roles: { main: { providerId: id, model: legacy['main_model'] ?? '' }, small, embedding },
  }
}

export function decodeByokBlob(raw: unknown): ByokBlobV2 {
  if (isV2(raw)) return raw
  if (isLegacy(raw)) return fromLegacy(raw)
  return { v: 2, providers: [], roles: { main: { providerId: '', model: '' }, small: null, embedding: null } }
}

export const encodeByokBlob = (blob: ByokBlobV2): ByokBlobV2 => blob
