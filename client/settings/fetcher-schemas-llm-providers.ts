// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { getJson } from './fetchers.js'

export const LlmProviderTypesSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'ollama',
  'groq',
  'custom',
])
export type LlmProviderType = z.infer<typeof LlmProviderTypesSchema>

export const PROVIDER_TYPE_BASE_URLS: Readonly<Partial<Record<LlmProviderType, string>>> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1/openai',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  openrouter: 'https://openrouter.ai/api/v1',
  ollama: 'http://localhost:11434/v1',
  groq: 'https://api.groq.com/openai/v1',
}

export const VerificationSchema = z.object({
  status: z.enum(['verified', 'unverified', 'error']),
  error: z.string().nullable(),
  at: z.number().nullable(),
  models: z.array(z.string()),
  modelsFetchedAt: z.number().nullable(),
})
export type Verification = z.infer<typeof VerificationSchema>

export const PublicProviderAccountSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerType: LlmProviderTypesSchema,
  baseUrl: z.string(),
  apiKeyMasked: z.string(),
  baseProvider: z.string().nullable().default(null),
  baseModel: z.string().nullable().default(null),
  verification: VerificationSchema,
})
export type PublicProviderAccount = z.infer<typeof PublicProviderAccountSchema>

const RoleBindingSchema = z.object({ providerId: z.string(), model: z.string() }).nullable()
export const LlmRoleBindingsSchema = z.object({
  main: z.object({ providerId: z.string(), model: z.string() }),
  small: RoleBindingSchema,
  embedding: RoleBindingSchema,
})
export type LlmRoleBindings = z.infer<typeof LlmRoleBindingsSchema>
export type RoleBinding = z.infer<typeof RoleBindingSchema>

export const AdminProvidersResponseSchema = z.object({ providers: z.array(PublicProviderAccountSchema) })
export type AdminProvidersResponse = z.infer<typeof AdminProvidersResponseSchema>

export const AdminLlmRolesResponseSchema = z.object({ roles: LlmRoleBindingsSchema })
export type AdminLlmRolesResponse = z.infer<typeof AdminLlmRolesResponseSchema>

export const ProviderInputSchema = z.object({
  label: z.string().min(1),
  providerType: LlmProviderTypesSchema,
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
})
export type ProviderInput = z.infer<typeof ProviderInputSchema>
export type ProviderPatch = Partial<ProviderInput> & { models?: string[] }

export const PROVIDER_TYPE_OPTIONS: ReadonlyArray<{ value: LlmProviderType; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'ollama', label: 'Ollama' },
  { value: 'groq', label: 'Groq' },
  { value: 'custom', label: 'Custom' },
]

export const LlmModelMetadataResponseSchema = z.object({
  providerId: z.string().nullable(),
  modelId: z.string().nullable(),
  contextWindow: z.number().nullable(),
  maxOutputTokens: z.number().nullable(),
  source: z.enum(['models-dev', 'prefix-table', 'none']),
  via: z.enum(['override', 'inferred']).nullable(),
  snapshotFetchedAt: z.number().nullable(),
})
export type LlmModelMetadata = z.infer<typeof LlmModelMetadataResponseSchema>

export type LlmModelMetadataQuery = {
  readonly providerType?: string
  readonly baseUrl?: string
  readonly baseProvider?: string
  readonly baseModel?: string
  readonly model?: string
}

export const fetchLlmModelMetadata = (input: LlmModelMetadataQuery): Promise<LlmModelMetadata> => {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== '') params.set(key, value)
  }
  const query = params.toString()
  const path = query.length > 0 ? `/settings/api/llm-model-metadata?${query}` : '/settings/api/llm-model-metadata'
  return getJson(path, (body) => LlmModelMetadataResponseSchema.parse(body))
}
