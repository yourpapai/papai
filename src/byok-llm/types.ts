// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const BYOK_LLM_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'] as const
export const REQUIRED_BYOK_LLM_KEYS = ['llm_apikey', 'llm_baseurl', 'main_model'] as const

export type ByokLlmKey = (typeof BYOK_LLM_KEYS)[number]
export type RequiredByokLlmKey = (typeof REQUIRED_BYOK_LLM_KEYS)[number]
export type ByokLlmConfig = Partial<Record<ByokLlmKey, string>> & Record<RequiredByokLlmKey, string>
export type PartialByokLlmConfig = Partial<Record<ByokLlmKey, string>>
export type ByokCredentialState = {
  readonly enabled: boolean
  readonly complete: boolean
  readonly missing: readonly RequiredByokLlmKey[]
}
export type ByokAdminSummary = ByokCredentialState & {
  readonly contextId: string
  readonly updatedAt: number
  readonly updatedBy: string
}
