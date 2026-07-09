// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { RepoEntry, RuntimeContext } from '../../../../src/modules/coding/acp/tools.js'
import {
  buildProjectSpec,
  buildSessionProjectSpec,
  canDeriveForge,
  getTool,
  listProjectsTool,
} from '../../../../src/modules/coding/acp/tools.js'
import { jsonResponse, options, runtimeCtx } from './support.js'

type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>
type CodingSecrets = RuntimeContext['codingSecrets']

function makeCodingSecrets(overrides?: Partial<CodingSecrets>): CodingSecrets {
  return {
    resolve: () => null,
    resolveForgeToken: () => null,
    resolveAgent: () => null,
    resolveForge: () => null,
    resolveProviderHost: () => null,
    resolveModel: () => null,
    resolveMcp: () => null,
    resolveMcpToken: () => undefined,
    ...overrides,
  }
}

const demoRepo: RepoEntry = {
  name: 'demo',
  repoUrl: 'https://github.com/acme/demo.git',
  baseBranch: 'main',
  permissionPreset: 'cautious',
}

function getAuthHeader(init: RequestInit | undefined): string {
  return new Headers(init?.headers).get('authorization') ?? ''
}

describe('buildSessionProjectSpec', () => {
  test('returns base projectSpec fields when forge and providerHost are null', () => {
    const secrets = makeCodingSecrets()
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(result).toEqual(buildProjectSpec(demoRepo, 'claude'))
    expect(Object.keys(result)).not.toContain('forge')
    expect(Object.keys(result)).not.toContain('providerHost')
  })

  test('includes forge when resolveForge returns a value', () => {
    const forge = { kind: 'github' as const, apiBaseUrl: 'https://api.github.com' }
    const secrets = makeCodingSecrets({ resolveForge: () => forge })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(result['forge']).toEqual(forge)
  })

  test('omits forge when resolveForge returns null', () => {
    const secrets = makeCodingSecrets({ resolveForge: () => null })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(Object.keys(result)).not.toContain('forge')
  })

  test('includes providerHost when resolveProviderHost returns a value', () => {
    const secrets = makeCodingSecrets({ resolveProviderHost: () => 'llm.corp.com' })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(result['providerHost']).toBe('llm.corp.com')
  })

  test('omits providerHost when resolveProviderHost returns null', () => {
    const secrets = makeCodingSecrets({ resolveProviderHost: () => null })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(Object.keys(result)).not.toContain('providerHost')
  })

  test('includes both forge and providerHost when both resolve', () => {
    const forge = { kind: 'gitlab' as const, apiBaseUrl: 'https://gl.corp.com/api/v4' }
    const secrets = makeCodingSecrets({
      resolveForge: () => forge,
      resolveProviderHost: () => 'api.openai.com',
    })
    const result = buildSessionProjectSpec(demoRepo, 'codex', secrets)
    expect(result['forge']).toEqual(forge)
    expect(result['providerHost']).toBe('api.openai.com')
    expect(result['agent']).toBe('codex')
  })

  test('includes model when resolveModel returns a value', () => {
    const secrets = makeCodingSecrets({ resolveModel: () => 'opus' })
    expect(buildSessionProjectSpec(demoRepo, 'claude', secrets)['model']).toBe('opus')
  })

  test('omits model when resolveModel returns null', () => {
    const secrets = makeCodingSecrets({ resolveModel: () => null })
    expect('model' in buildSessionProjectSpec(demoRepo, 'claude', secrets)).toBe(false)
  })

  test('includes mcp.toolPolicy when resolveMcp returns a value carrying one', () => {
    const mcp = {
      url: 'https://mcp.corp.com',
      host: 'mcp.corp.com',
      header: 'Authorization',
      allowedHosts: ['mcp.corp.com'],
      toolPolicy: { default: 'deny' as const, tools: { echo: 'allow' as const } },
    }
    const secrets = makeCodingSecrets({ resolveMcp: () => mcp })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(result['mcp']).toHaveProperty('toolPolicy', mcp.toolPolicy)
  })

  test('omits mcp.toolPolicy when resolveMcp returns a value without one', () => {
    const mcp = {
      url: 'https://mcp.corp.com',
      host: 'mcp.corp.com',
      header: 'Authorization',
      allowedHosts: ['mcp.corp.com'],
    }
    const secrets = makeCodingSecrets({ resolveMcp: () => mcp })
    const result = buildSessionProjectSpec(demoRepo, 'claude', secrets)
    expect(result['mcp']).toEqual(mcp)
    expect(result['mcp']).not.toHaveProperty('toolPolicy')
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

describe('acp read tools', () => {
  test('list_projects returns the catalogue without calling httpFetch', async () => {
    const httpFetch = mock((): Promise<Response> => Promise.resolve(jsonResponse([])))
    const result = await listProjectsTool().execute({}, runtimeCtx(), options())
    expect(result).toEqual([{ name: 'demo', baseBranch: 'main' }])
    expect(httpFetch).not.toHaveBeenCalled()
  })

  test('list_projects returns empty list when no repos configured', async () => {
    const emptyCodingRepos = {
      list: (): { name: string; baseBranch: string }[] => [],
      get: (_name: string): null => null,
    }
    const result = await listProjectsTool().execute({}, runtimeCtx(undefined, emptyCodingRepos), options())
    expect(result).toEqual([])
  })

  test('list_agents GETs /agents', async () => {
    const httpFetch: HttpFetch = () => Promise.resolve(jsonResponse([{ name: 'claude-code-acp' }]))
    const tool = getTool('list_agents', 'List coding agents available in magi.', '/agents', httpFetch)
    const result = await tool.execute({}, runtimeCtx(), options())
    expect(result).toEqual([{ name: 'claude-code-acp' }])
  })

  test('list_agents uses bearer auth', async () => {
    let seenAuth = ''
    const httpFetch: HttpFetch = (_url, init) => {
      seenAuth = getAuthHeader(init)
      return Promise.resolve(jsonResponse([]))
    }
    const tool = getTool('list_agents', 'List coding agents available in magi.', '/agents', httpFetch)
    await tool.execute({}, runtimeCtx(), options())
    expect(seenAuth).toBe('Bearer tok')
  })
})
