// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { pluginManifestSchema } from '../../src/plugins/types.js'

describe('pluginManifestSchema providerConfigSchema scope', () => {
  const base = {
    id: 'p',
    name: 'P',
    version: '1.0.0',
    description: 'd',
    apiVersion: 1,
    main: 'index.ts',
    permissions: ['provider.task'],
    contributes: { taskProviderTypes: ['p'] },
  }

  test('defaults provider config field scope to instance', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerConfigSchema: [{ key: 'base_url', label: 'URL', required: true }],
    })
    expect(parsed.providerConfigSchema[0]?.scope).toBe('instance')
  })

  test('rejects legacy user scope', () => {
    const result = pluginManifestSchema.safeParse({
      ...base,
      providerConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true, scope: 'user' }],
    })
    expect(result.success).toBe(false)
  })

  test('defaults provider context config field scope to context', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerContextConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true }],
    })
    expect(parsed.providerContextConfigSchema?.[0]?.scope).toBe('context')
  })

  test('parsed plugin manifest exposes defaulted provider arrays', () => {
    const parsed = pluginManifestSchema.parse({
      id: 'defaults-plugin',
      name: 'Defaults Plugin',
      version: '1.0.0',
      description: 'defaults',
      apiVersion: 1,
      main: 'index.ts',
    })

    expect(parsed.providerTraits).toEqual([])
    expect(parsed.providerContextConfigSchema).toEqual([])
  })
})

describe('pluginManifestSchema strict validation', () => {
  test('rejects unknown top-level manifest keys', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'strict-top-level',
      name: 'Strict Top Level',
      version: '1.0.0',
      description: 'strict',
      apiVersion: 1,
      unexpected: true,
    })

    expect(result.success).toBe(false)
  })

  test('rejects semver strings with trailing junk', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'bad-semver',
      name: 'Bad Semver',
      version: '1.0.0-beta trailing',
      description: 'strict semver',
      apiVersion: 1,
    })

    expect(result.success).toBe(false)
  })

  test('rejects Windows absolute main paths', () => {
    const driveLetterResult = pluginManifestSchema.safeParse({
      id: 'windows-drive-main',
      name: 'Windows Drive Main',
      version: '1.0.0',
      description: 'windows path',
      apiVersion: 1,
      main: 'C:\\plugin\\index.ts',
    })
    const uncResult = pluginManifestSchema.safeParse({
      id: 'windows-unc-main',
      name: 'Windows UNC Main',
      version: '1.0.0',
      description: 'windows path',
      apiVersion: 1,
      main: '\\\\server\\share\\index.ts',
    })

    expect(driveLetterResult.success).toBe(false)
    expect(uncResult.success).toBe(false)
  })

  test('accepts main paths whose filename contains dot-dot but no parent segment', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'dotted-main',
      name: 'Dotted Main',
      version: '1.0.0',
      description: 'dotted filename',
      apiVersion: 1,
      main: 'plugin..entry.ts',
    })

    expect(result.success).toBe(true)
  })

  test('rejects Windows-style parent traversal main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-traversal-main',
      name: 'Windows Parent Traversal Main',
      version: '1.0.0',
      description: 'windows parent traversal',
      apiVersion: 1,
      main: '..\\outside.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw POSIX parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'posix-parent-segment-main',
      name: 'POSIX Parent Segment Main',
      version: '1.0.0',
      description: 'posix parent segment',
      apiVersion: 1,
      main: 'foo/../index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw Windows parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-segment-main',
      name: 'Windows Parent Segment Main',
      version: '1.0.0',
      description: 'windows parent segment',
      apiVersion: 1,
      main: 'foo\\..\\index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw POSIX parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'posix-parent-segment-main',
      name: 'POSIX Parent Segment Main',
      version: '1.0.0',
      description: 'posix parent segment',
      apiVersion: 1,
      main: 'foo/../index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects raw Windows parent-segment main paths', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'windows-parent-segment-main',
      name: 'Windows Parent Segment Main',
      version: '1.0.0',
      description: 'windows parent segment',
      apiVersion: 1,
      main: 'foo\\..\\index.ts',
    })

    expect(result.success).toBe(false)
  })

  test('rejects configKeys without matching context-scoped config requirement', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'bad-config-keys',
      name: 'Bad Config Keys',
      version: '1.0.0',
      description: 'bad config key mapping',
      apiVersion: 1,
      contributes: { configKeys: ['api_token'] },
      configRequirements: [{ key: 'other_key', label: 'Other', required: true, scope: 'context' }],
    })

    expect(result.success).toBe(false)
  })

  test('rejects admin-scoped configKeys entries', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'admin-config-key',
      name: 'Admin Config Key',
      version: '1.0.0',
      description: 'admin config key mismatch',
      apiVersion: 1,
      contributes: { configKeys: ['api_token'] },
      configRequirements: [{ key: 'api_token', label: 'API Token', required: true, scope: 'admin' }],
    })

    expect(result.success).toBe(false)
  })

  test('rejects provider-only fields without provider.task permission', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'provider-fields-without-permission',
      name: 'Provider Fields Without Permission',
      version: '1.0.0',
      description: 'provider fields without permission',
      apiVersion: 1,
      main: 'index.ts',
      providerCapabilities: ['tasks.delete'],
      providerConfigSchema: [{ key: 'base_url', label: 'Base URL', required: true }],
      providerContextConfigSchema: [{ key: 'api_key', label: 'API Key', required: true, sensitive: true }],
      providerAllowedHosts: ['example.com'],
      providerConfigValidator: 'validateConfig',
    })

    expect(result.success).toBe(false)
  })

  test('rejects providerConfigValidator when no task provider type is declared', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'validator-without-provider-type',
      name: 'Validator Without Provider Type',
      version: '1.0.0',
      description: 'validator without provider type',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['provider.task'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      providerConfigValidator: 'validateConfig',
    })

    expect(result.success).toBe(false)
  })

  test('accepts providerAllowedHosts for http-only plugins', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'http-host-allowlist',
      name: 'HTTP Host Allowlist',
      version: '1.0.0',
      description: 'http-only provider runtime host allowlist',
      apiVersion: 1,
      main: 'index.ts',
      permissions: ['http'],
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      providerAllowedHosts: ['example.com'],
    })

    expect(result.success).toBe(true)
  })

  test('accepts explicit mcp-only manifests without main', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'mcp-only-schema',
      name: 'MCP Only Schema',
      version: '1.0.0',
      description: 'mcp only schema',
      apiVersion: 1,
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })

    expect(result.success).toBe(true)
    expect(result.data?.main).toBeUndefined()
  })

  test('rejects mcp-only manifests without main when provider-only metadata is present', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'mcp-only-provider-metadata',
      name: 'MCP Only Provider Metadata',
      version: '1.0.0',
      description: 'mcp only with provider metadata',
      apiVersion: 1,
      contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
      permissions: ['provider.task'],
      providerAllowedHosts: ['example.com'],
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })

    expect(result.success).toBe(false)
  })

  test('rejects mcp manifests that also declare runtime contributions without main', () => {
    const result = pluginManifestSchema.safeParse({
      id: 'mixed-mcp-runtime',
      name: 'Mixed MCP Runtime',
      version: '1.0.0',
      description: 'mixed runtime',
      apiVersion: 1,
      contributes: {
        tools: ['search'],
        promptFragments: [],
        commands: [],
        jobs: [],
        configKeys: [],
        taskProviderTypes: [],
      },
      mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
    })

    expect(result.success).toBe(false)
  })
})
