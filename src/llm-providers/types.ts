// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

// src/llm-providers/types.ts
// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const LLM_PROVIDER_TYPES = ['openai', 'anthropic', 'google', 'openrouter', 'ollama', 'groq', 'custom'] as const
export type LlmProviderType = (typeof LLM_PROVIDER_TYPES)[number]

export const VERIFICATION_STATUSES = ['verified', 'unverified', 'error'] as const
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number]

export type Verification = {
  readonly status: VerificationStatus
  readonly error: string | null
  readonly at: number | null
  readonly models: readonly string[]
  readonly modelsFetchedAt: number | null
}

/** Decrypted provider account as used in memory (admin or per-context). */
export type LlmProviderAccount = {
  readonly id: string
  readonly label: string
  readonly providerType: LlmProviderType
  readonly baseUrl: string
  readonly apiKey: string
  readonly baseProvider: string | null
  readonly baseModel: string | null
  readonly verification: Verification
}

export type RoleBinding = { readonly providerId: string; readonly model: string } | null

export type LlmRoleBindings = {
  readonly main: { readonly providerId: string; readonly model: string }
  readonly small: RoleBinding
  readonly embedding: RoleBinding
}

export type ResolvedRole = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly model: string
  readonly source: 'global' | 'byok'
}

export type EffectiveLlmConfig = {
  readonly ok: true
  readonly source: 'global' | 'byok' | 'mixed'
  readonly main: ResolvedRole
  readonly small: ResolvedRole
  readonly embedding: ResolvedRole
}

export type LlmConfigMissing = {
  readonly ok: false
  readonly type: 'missing'
  readonly source: 'global' | 'byok'
  readonly missing: readonly string[]
}

export type LlmConfigError = {
  readonly ok: false
  readonly type: 'error'
  readonly source: 'byok'
  readonly error: string
}

export type LlmConfigResult = EffectiveLlmConfig | LlmConfigMissing | LlmConfigError
