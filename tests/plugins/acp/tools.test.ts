// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { RepoEntry, RuntimeContext } from '../../../plugins/acp/tools.js'
import { buildProjectSpec, buildSessionProjectSpec, canDeriveForge } from '../../../plugins/acp/tools.js'

type CodingSecrets = RuntimeContext['codingSecrets']

function makeCodingSecrets(overrides?: Partial<CodingSecrets>): CodingSecrets {
  return {
    resolve: () => null,
    resolveForgeToken: () => null,
    resolveAgent: () => null,
    resolveForge: () => null,
    resolveProviderHost: () => null,
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
