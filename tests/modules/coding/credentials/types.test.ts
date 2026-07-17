// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  AGENT_PROVIDER_FIELDS,
  AGENTS,
  AUTH_METHODS,
  CODING_NAMESPACES,
  FIELDS_BY_NAMESPACE,
  FORGE_KINDS,
  PROVIDERS,
  REQUIRED_AGENT_PROVIDER_FIELDS,
  REQUIRED_BY_NAMESPACE,
  compatible,
  deriveApiBaseUrl,
  forgeMagiKind,
  isAuthMethod,
} from '../../../../src/modules/coding/credentials/types.js'

describe('coding-credentials types', () => {
  test('CODING_NAMESPACES contains agent-provider', () => {
    expect(CODING_NAMESPACES).toContain('agent-provider')
  })

  test('AGENT_PROVIDER_FIELDS contains provider_api_key and provider_base_url', () => {
    expect(AGENT_PROVIDER_FIELDS).toContain('provider_api_key')
    expect(AGENT_PROVIDER_FIELDS).toContain('provider_base_url')
  })

  test('REQUIRED_AGENT_PROVIDER_FIELDS contains provider, agent, and provider_api_key', () => {
    expect(REQUIRED_AGENT_PROVIDER_FIELDS).toContain('provider')
    expect(REQUIRED_AGENT_PROVIDER_FIELDS).toContain('agent')
    expect(REQUIRED_AGENT_PROVIDER_FIELDS).toContain('provider_api_key')
  })

  test('AGENT_PROVIDER_FIELDS contains provider and agent', () => {
    expect(AGENT_PROVIDER_FIELDS).toContain('provider')
    expect(AGENT_PROVIDER_FIELDS).toContain('agent')
  })

  test('PROVIDERS contains anthropic and openai', () => {
    expect(PROVIDERS).toContain('anthropic')
    expect(PROVIDERS).toContain('openai')
  })

  test('AGENTS contains claude, codex, and opencode', () => {
    expect(AGENTS).toContain('claude')
    expect(AGENTS).toContain('codex')
    expect(AGENTS).toContain('opencode')
  })

  test('FIELDS_BY_NAMESPACE maps agent-provider to all fields', () => {
    expect(FIELDS_BY_NAMESPACE['agent-provider']).toEqual(AGENT_PROVIDER_FIELDS)
  })

  test('REQUIRED_BY_NAMESPACE maps agent-provider to required fields', () => {
    expect(REQUIRED_BY_NAMESPACE['agent-provider']).toEqual(REQUIRED_AGENT_PROVIDER_FIELDS)
  })

  describe('mcp coding-credentials namespace', () => {
    test('is a known namespace', () => {
      expect(CODING_NAMESPACES).toContain('mcp')
    })

    test('declares a single servers field (JSON-encoded selection array), not required', () => {
      expect(FIELDS_BY_NAMESPACE.mcp).toEqual(['servers'])
      expect(REQUIRED_BY_NAMESPACE.mcp).toEqual([])
    })
  })

  describe('FORGE_KINDS', () => {
    test('FORGE_KINDS contains all four code-host kinds', () => {
      expect(FORGE_KINDS).toContain('github')
      expect(FORGE_KINDS).toContain('github-enterprise')
      expect(FORGE_KINDS).toContain('gitlab')
      expect(FORGE_KINDS).toContain('gitlab-self-hosted')
    })
  })

  describe('deriveApiBaseUrl', () => {
    test('github returns the fixed SaaS API base URL', () => {
      expect(deriveApiBaseUrl('github', undefined)).toBe('https://api.github.com')
    })

    test('gitlab returns the fixed SaaS API base URL', () => {
      expect(deriveApiBaseUrl('gitlab', undefined)).toBe('https://gitlab.com/api/v4')
    })

    test('github-enterprise appends /api/v3 to the instance URL', () => {
      expect(deriveApiBaseUrl('github-enterprise', 'https://ghe.corp.com')).toBe('https://ghe.corp.com/api/v3')
    })

    test('gitlab-self-hosted appends /api/v4 to the instance URL, stripping trailing slash', () => {
      expect(deriveApiBaseUrl('gitlab-self-hosted', 'https://gitlab.corp.com/')).toBe('https://gitlab.corp.com/api/v4')
    })

    test('unknown kind throws', () => {
      expect(() => deriveApiBaseUrl('bitbucket', undefined)).toThrow('unknown forge kind: bitbucket')
    })
  })

  describe('forgeMagiKind', () => {
    test('github maps to github', () => {
      expect(forgeMagiKind('github')).toBe('github')
    })

    test('github-enterprise maps to github', () => {
      expect(forgeMagiKind('github-enterprise')).toBe('github')
    })

    test('gitlab maps to gitlab', () => {
      expect(forgeMagiKind('gitlab')).toBe('gitlab')
    })

    test('gitlab-self-hosted maps to gitlab', () => {
      expect(forgeMagiKind('gitlab-self-hosted')).toBe('gitlab')
    })
  })

  test('AUTH_METHODS lists api-key and oauth-subscription', () => {
    expect(AUTH_METHODS).toEqual(['api-key', 'oauth-subscription'])
  })

  test('auth_method is an optional agent-provider field (not required)', () => {
    expect(AGENT_PROVIDER_FIELDS).toContain('auth_method')
    expect(REQUIRED_AGENT_PROVIDER_FIELDS).not.toContain('auth_method')
  })

  test('isAuthMethod narrows known methods', () => {
    expect(isAuthMethod('oauth-subscription')).toBe(true)
    expect(isAuthMethod('nope')).toBe(false)
  })

  describe('compatible', () => {
    test('claude is compatible only with anthropic', () => {
      expect(compatible('claude', 'anthropic')).toBe(true)
      expect(compatible('claude', 'openai')).toBe(false)
    })

    test('codex is compatible only with openai', () => {
      expect(compatible('codex', 'openai')).toBe(true)
      expect(compatible('codex', 'anthropic')).toBe(false)
    })

    test('opencode is compatible with both providers', () => {
      expect(compatible('opencode', 'anthropic')).toBe(true)
      expect(compatible('opencode', 'openai')).toBe(true)
    })

    test('unknown agent/provider returns false', () => {
      expect(compatible('bogus', 'anthropic')).toBe(false)
      expect(compatible('claude', 'bogus')).toBe(false)
    })

    test('openai-compatible provider + compatibility', () => {
      expect(PROVIDERS).toContain('openai-compatible')
      expect(compatible('opencode', 'openai-compatible')).toBe(true)
      expect(compatible('codex', 'openai-compatible')).toBe(true)
      expect(compatible('claude', 'openai-compatible')).toBe(false)
    })
  })
})
