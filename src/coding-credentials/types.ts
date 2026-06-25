// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const CODING_NAMESPACES = ['agent-provider'] as const
export type CodingNamespace = (typeof CODING_NAMESPACES)[number]

export const AGENT_PROVIDER_FIELDS = ['provider_api_key', 'provider_base_url'] as const
export const REQUIRED_AGENT_PROVIDER_FIELDS = ['provider_api_key'] as const
export type AgentProviderField = (typeof AGENT_PROVIDER_FIELDS)[number]
export type RequiredAgentProviderField = (typeof REQUIRED_AGENT_PROVIDER_FIELDS)[number]

export type CodingCredentialConfig = Partial<Record<AgentProviderField, string>>

export type CodingCredentialState = {
  readonly configured: boolean
  readonly complete: boolean
  readonly missing: readonly RequiredAgentProviderField[]
} & Partial<{ readonly unreadable: true; readonly error: string }>

// Phase 1 implements only the agent-provider namespace; Phase 2 adds 'forge'.
export const FIELDS_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': AGENT_PROVIDER_FIELDS,
}
export const REQUIRED_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': REQUIRED_AGENT_PROVIDER_FIELDS,
}
