// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { McpUpstream, RepoEntry, RuntimeContext } from '../../../plugins/acp/tools.js'
import { buildProjectSpec, buildSessionProjectSpec, canDeriveForge } from '../../../plugins/acp/tools.js'

type CodingSecrets = RuntimeContext['codingSecrets']

function makeCodingSecrets(overrides?: Partial<CodingSecrets>): CodingSecrets {
  return {
    resolve: () => null,
    resolveForgeToken: () => null,
    resolveAgent: () => null,
    resolveForge: () => null,
    resolveProviderHost: () => null,
    resolveModel: () => null,
    resolveMcpServers: () => ({ ok: true, servers: [] }),
    resolveMcpTokens: () => ({}),
    ...overrides,
  }
}

const demoRepo: RepoEntry = {
  name: 'demo',
  repoUrl: 'https://github.com/acme/demo.git',
  baseBranch: 'main',
  permissionPreset: 'cautious',
}

describe('buildSessionProjectSpec', () => {
  test('returns base projectSpec fields when forge and providerHost are null', () => {
    const secrets = makeCodingSecrets()
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(result).toEqual(buildProjectSpec(demoRepo, 'claude'))
    expect(Object.keys(result)).not.toContain('forge')
    expect(Object.keys(result)).not.toContain('providerHost')
  })

  test('includes forge when resolveForge returns a value', () => {
    const forge = { kind: 'github' as const, apiBaseUrl: 'https://api.github.com' }
    const secrets = makeCodingSecrets({ resolveForge: () => forge })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(result['forge']).toEqual(forge)
  })

  test('omits forge when resolveForge returns null', () => {
    const secrets = makeCodingSecrets({ resolveForge: () => null })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(Object.keys(result)).not.toContain('forge')
  })

  test('includes providerHost when resolveProviderHost returns a value', () => {
    const secrets = makeCodingSecrets({ resolveProviderHost: () => 'llm.corp.com' })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(result['providerHost']).toBe('llm.corp.com')
  })

  test('omits providerHost when resolveProviderHost returns null', () => {
    const secrets = makeCodingSecrets({ resolveProviderHost: () => null })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(Object.keys(result)).not.toContain('providerHost')
  })

  test('includes both forge and providerHost when both resolve', () => {
    const forge = { kind: 'gitlab' as const, apiBaseUrl: 'https://gl.corp.com/api/v4' }
    const secrets = makeCodingSecrets({
      resolveForge: () => forge,
      resolveProviderHost: () => 'api.openai.com',
    })
    const result = buildSessionProjectSpec(demoRepo, 'codex', secrets, [])
    expect(result['forge']).toEqual(forge)
    expect(result['providerHost']).toBe('api.openai.com')
    expect(result['agent']).toBe('codex')
  })

  test('includes model when resolveModel returns a value', () => {
    const secrets = makeCodingSecrets({ resolveModel: () => 'opus' })
    expect(buildSessionProjectSpec(demoRepo, 'claude', secrets, [])['model']).toBe('opus')
  })

  test('omits model when resolveModel returns null', () => {
    const secrets = makeCodingSecrets({ resolveModel: () => null })
    expect('model' in buildSessionProjectSpec(demoRepo, 'claude', secrets, [])).toBe(false)
  })

  test('includes mcp[] with toolPolicy when a passed-in server carries one', () => {
    const mcp: McpUpstream = {
      id: 'jira-mcp',
      url: 'https://mcp.corp.com',
      host: 'mcp.corp.com',
      header: 'Authorization',
      allowedHosts: ['mcp.corp.com'],
      toolPolicy: { default: 'deny' as const, tools: { echo: 'allow' as const } },
    }
    const secrets = makeCodingSecrets()
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [mcp])
    expect(result['mcp']).toEqual([mcp])
  })

  test('mcp[] entries omit toolPolicy when the passed-in server has none', () => {
    const mcp: McpUpstream = {
      id: 'jira-mcp',
      url: 'https://mcp.corp.com',
      host: 'mcp.corp.com',
      header: 'Authorization',
      allowedHosts: ['mcp.corp.com'],
    }
    const secrets = makeCodingSecrets()
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [mcp])
    // toEqual is a strict recursive comparison, so this also proves no stray toolPolicy key crept in.
    expect(result['mcp']).toEqual([mcp])
  })

  test('omits mcp entirely when the passed-in servers array is empty', () => {
    const secrets = makeCodingSecrets()
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets, [])
    expect(Object.keys(result)).not.toContain('mcp')
  })
})

describe('buildProjectSpec', () => {
  test('includes additionalEgressDomains when non-empty', () => {
    const spec = buildProjectSpec({ ...demoRepo, additionalEgressDomains: ['pypi.org'] }, 'claude')
    expect(spec).toMatchObject({ additionalEgressDomains: ['pypi.org'] })
  })

  test('omits additionalEgressDomains when empty', () => {
    const spec = buildProjectSpec({ ...demoRepo, additionalEgressDomains: [] }, 'claude')
    expect('additionalEgressDomains' in spec).toBe(false)
  })
})

describe('canDeriveForge', () => {
  test('true for github.com (SaaS)', () => {
    expect(canDeriveForge('https://github.com/acme/demo.git')).toBe(true)
  })

  test('true for gitlab.com (SaaS)', () => {
    expect(canDeriveForge('https://gitlab.com/acme/demo.git')).toBe(true)
  })

  test('false for a self-hosted host', () => {
    expect(canDeriveForge('https://gl.corp.com/acme/demo.git')).toBe(false)
  })

  test('false for an invalid url', () => {
    expect(canDeriveForge('git@github.com:acme/demo.git')).toBe(false)
  })
})
