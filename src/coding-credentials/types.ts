// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const CODING_NAMESPACES = ['agent-provider', 'forge', 'mcp'] as const
export type CodingNamespace = (typeof CODING_NAMESPACES)[number]

export const PROVIDERS = ['anthropic', 'openai', 'openai-compatible'] as const
export type Provider = (typeof PROVIDERS)[number]

export const AUTH_METHODS = ['api-key', 'oauth-subscription'] as const
export type AuthMethod = (typeof AUTH_METHODS)[number]

export function isAuthMethod(value: string): value is AuthMethod {
  return (AUTH_METHODS as readonly string[]).includes(value)
}

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
  if (agent === 'codex') return provider === 'openai' || provider === 'openai-compatible'
  if (agent === 'opencode') return provider === 'anthropic' || provider === 'openai' || provider === 'openai-compatible'
  return false
}

export const AGENT_PROVIDER_FIELDS = [
  'agent',
  'provider',
  'auth_method',
  'provider_api_key',
  'provider_base_url',
  'model',
] as const
export const REQUIRED_AGENT_PROVIDER_FIELDS = ['agent', 'provider', 'provider_api_key'] as const
export type AgentProviderField = (typeof AGENT_PROVIDER_FIELDS)[number]

export const FORGE_FIELDS = ['kind', 'instance_url', 'forge_token'] as const
export const REQUIRED_FORGE_FIELDS = ['kind', 'forge_token'] as const
export type ForgeField = (typeof FORGE_FIELDS)[number]

export const MCP_FIELDS = ['servers'] as const
export const REQUIRED_MCP_FIELDS = [] as const
export type McpField = (typeof MCP_FIELDS)[number]

export const FORGE_KINDS = ['github', 'github-enterprise', 'gitlab', 'gitlab-self-hosted'] as const
export type ForgeKindUi = (typeof FORGE_KINDS)[number]

export function isForgeKind(v: string): v is ForgeKindUi {
  return (FORGE_KINDS as readonly string[]).includes(v)
}

export function needsInstanceUrl(kind: string): boolean {
  return kind === 'github-enterprise' || kind === 'gitlab-self-hosted'
}

export function forgeMagiKind(kind: string): 'github' | 'gitlab' {
  return kind.startsWith('gitlab') ? 'gitlab' : 'github'
}

const stripSlash = (u: string): string => u.replace(/\/+$/u, '')

export function deriveApiBaseUrl(kind: string, instanceUrl: string | undefined): string {
  if (kind === 'github') return 'https://api.github.com'
  if (kind === 'gitlab') return 'https://gitlab.com/api/v4'
  if (kind === 'github-enterprise') return `${stripSlash(instanceUrl ?? '')}/api/v3`
  if (kind === 'gitlab-self-hosted') return `${stripSlash(instanceUrl ?? '')}/api/v4`
  throw new Error(`unknown forge kind: ${kind}`)
}

export function deriveProviderHost(provider: string, baseUrl: string | undefined): string | null {
  const base = baseUrl?.trim()
  if (base !== undefined && base.length > 0) {
    try {
      return new URL(base).host
    } catch {
      return null
    }
  }
  if (provider === 'anthropic') return 'api.anthropic.com'
  if (provider === 'openai') return 'api.openai.com'
  // openai-compatible without a base URL — host cannot be determined
  return null
}

export type CodingCredentialConfig = Partial<Record<AgentProviderField | ForgeField | McpField, string>>

export type CodingCredentialState = {
  readonly configured: boolean
  readonly complete: boolean
  readonly missing: readonly string[]
} & Partial<{ readonly unreadable: true; readonly error: string }>

export const FIELDS_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': AGENT_PROVIDER_FIELDS,
  forge: FORGE_FIELDS,
  mcp: MCP_FIELDS,
}
export const REQUIRED_BY_NAMESPACE: Record<CodingNamespace, readonly string[]> = {
  'agent-provider': REQUIRED_AGENT_PROVIDER_FIELDS,
  forge: REQUIRED_FORGE_FIELDS,
  mcp: REQUIRED_MCP_FIELDS,
}
