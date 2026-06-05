// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  hasMatchingContextConfigKeys,
  hasProviderManifestPermission,
  hasRequiredMainForManifest,
  isValidMainPath,
} from '../../src/plugins/manifest-validation.js'

describe('isValidMainPath', () => {
  test('accepts relative .ts paths', () => {
    expect(isValidMainPath('index.ts')).toBe(true)
  })

  test('accepts relative .js paths', () => {
    expect(isValidMainPath('src/index.js')).toBe(true)
  })

  test('rejects absolute paths', () => {
    expect(isValidMainPath('/absolute/index.ts')).toBe(false)
  })

  test('rejects parent traversal', () => {
    expect(isValidMainPath('../outside/index.ts')).toBe(false)
  })

  test('rejects non-ts/js extensions', () => {
    expect(isValidMainPath('index.py')).toBe(false)
  })
})

describe('hasProviderManifestPermission', () => {
  const base = {
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    contributes: {
      configKeys: [],
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      taskProviderTypes: [],
      chatProviderTypes: [],
    },
    configRequirements: [],
  }

  test('allows empty provider fields without any provider permission', () => {
    expect(hasProviderManifestPermission({ ...base, permissions: [] })).toBe(true)
  })

  test('allows provider.task permission with task provider types', () => {
    expect(
      hasProviderManifestPermission({
        ...base,
        permissions: ['provider.task'],
        contributes: { ...base.contributes, taskProviderTypes: ['kaneo'] },
        providerCapabilities: ['tasks.delete'],
        providerConfigSchema: [{ key: 'url', label: 'URL', required: true }],
      }),
    ).toBe(true)
  })

  test('allows provider.chat permission with chat provider types', () => {
    expect(
      hasProviderManifestPermission({
        ...base,
        permissions: ['provider.chat'],
        contributes: { ...base.contributes, chatProviderTypes: ['telegram'] },
        providerAllowedHosts: ['api.telegram.org'],
      }),
    ).toBe(true)
  })

  test('rejects provider fields without any provider permission', () => {
    expect(
      hasProviderManifestPermission({
        ...base,
        permissions: [],
        providerCapabilities: ['tasks.delete'],
      }),
    ).toBe(false)
  })

  test('allows providerAllowedHosts with http permission', () => {
    expect(
      hasProviderManifestPermission({
        ...base,
        permissions: ['http'],
        providerAllowedHosts: ['example.com'],
      }),
    ).toBe(true)
  })
})

describe('hasMatchingContextConfigKeys', () => {
  test('returns true when no config keys declared', () => {
    expect(
      hasMatchingContextConfigKeys({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [],
      }),
    ).toBe(true)
  })

  test('returns true when config keys match context requirements', () => {
    expect(
      hasMatchingContextConfigKeys({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: ['api_key'],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [{ key: 'api_key', scope: 'context' }],
      }),
    ).toBe(true)
  })

  test('returns false when config keys do not match', () => {
    expect(
      hasMatchingContextConfigKeys({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: ['api_key'],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [{ key: 'other_key', scope: 'context' }],
      }),
    ).toBe(false)
  })
})

describe('hasRequiredMainForManifest', () => {
  test('requires main when there are runtime contributions', () => {
    expect(
      hasRequiredMainForManifest({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: ['search'],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [],
        main: 'index.ts',
      }),
    ).toBe(true)
  })

  test('rejects missing main when there are runtime contributions', () => {
    expect(
      hasRequiredMainForManifest({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: ['search'],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [],
      }),
    ).toBe(false)
  })

  test('allows missing main for mcp-only plugins', () => {
    expect(
      hasRequiredMainForManifest({
        permissions: [],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: [],
        },
        configRequirements: [],
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
      }),
    ).toBe(true)
  })

  test('requires main when chatProviderTypes are declared', () => {
    expect(
      hasRequiredMainForManifest({
        permissions: ['provider.chat'],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: ['telegram'],
        },
        configRequirements: [],
      }),
    ).toBe(false)
  })

  test('accepts main when chatProviderTypes are declared', () => {
    expect(
      hasRequiredMainForManifest({
        permissions: ['provider.chat'],
        providerCapabilities: [],
        providerConfigSchema: [],
        providerAllowedHosts: [],
        contributes: {
          configKeys: [],
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          taskProviderTypes: [],
          chatProviderTypes: ['telegram'],
        },
        configRequirements: [],
        main: 'index.ts',
      }),
    ).toBe(true)
  })
})
