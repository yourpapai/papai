// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const CODING_NAMESPACES = ['agent-provider', 'forge'] as const
export type CodingNamespace = (typeof CODING_NAMESPACES)[number]

export const PROVIDERS = ['anthropic', 'openai'] as const
export type Provider = (typeof PROVIDERS)[number]

export const AGENTS = ['claude', 'codex', 'opencode'] as const
export type Agent = (typeof AGENTS)[number]

export function isAgent(value: string): value is Agent {
  return (AGENTS as readonly string[]).includes(value)
}

export function isProvider(value: string): value is Provider {
  return (PROVIDERS as readonly string[]).includes(value)
}

export function compatible(agent: string, provider: string): boolean {
  if (agent === 'claude') return provider === 'anthropic'
  if (agent === 'codex') return provider === 'openai'
  if (agent === 'opencode') return provider === 'anthropic' || provider === 'openai'
  return false
}

export const AGENT_PROVIDER_FIELDS = ['agent', 'provider', 'provider_api_key', 'provider_base_url'] as const
export const REQUIRED_AGENT_PROVIDER_FIELDS = ['agent', 'provider', 'provider_api_key'] as const
export type AgentProviderField = (typeof AGENT_PROVIDER_FIELDS)[number]

export const FORGE_FIELDS = ['forge_token'] as const
export const REQUIRED_FORGE_FIELDS = ['forge_token'] as const
export type ForgeField = (typeof FORGE_FIELDS)[number]

export type CodingCredentialConfig = Partial<Record<AgentProviderField | ForgeField, string>>

export type CodingCredentialState = {
  readonly configured: boolean
  readonly complete: boolean
  readonly missing: readonly string[]
} & Partial<{ readonly unreadable: true; readonly error: string }>

export const FIELDS_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': AGENT_PROVIDER_FIELDS,
  forge: FORGE_FIELDS,
}
export const REQUIRED_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': REQUIRED_AGENT_PROVIDER_FIELDS,
  forge: REQUIRED_FORGE_FIELDS,
}
