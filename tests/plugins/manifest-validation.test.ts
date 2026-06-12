// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  hasAttachmentTransformerPermission,
  hasProviderAllowedHostsFromConfig,
  hasProviderManifestPermission,
  hasRequiredMainForManifest,
} from '../../src/plugins/manifest-validation.js'

const baseInput = {
  permissions: [] as string[],
  providerCapabilities: [],
  providerConfigSchema: [],
  providerContextConfigSchema: [],
  providerAllowedHosts: [],
  providerAllowedHostsFromConfig: [] as string[],
  providerConfigValidator: undefined,
  contributes: {
    configKeys: [],
    tools: [],
    promptFragments: [],
    commands: [],
    jobs: [],
    taskProviderTypes: [],
    attachmentTransformers: [] as unknown[],
  },
  configRequirements: [] as { key: string; scope: 'context' | 'admin' }[],
  mcp: undefined,
  main: 'index.ts',
}

describe('hasAttachmentTransformerPermission', () => {
  test('returns true when no transformers declared', () => {
    expect(hasAttachmentTransformerPermission({ ...baseInput })).toBe(true)
  })

  test('returns true when transformers declared and attachments.read permission present', () => {
    expect(
      hasAttachmentTransformerPermission({
        ...baseInput,
        permissions: ['attachments.read'],
        contributes: { ...baseInput.contributes, attachmentTransformers: ['my_transformer'] },
      }),
    ).toBe(true)
  })

  test('returns false when transformers declared without attachments.read permission', () => {
    expect(
      hasAttachmentTransformerPermission({
        ...baseInput,
        contributes: { ...baseInput.contributes, attachmentTransformers: ['my_transformer'] },
      }),
    ).toBe(false)
  })
})

describe('hasProviderAllowedHostsFromConfig', () => {
  test('returns true when no config host keys declared', () => {
    expect(hasProviderAllowedHostsFromConfig({ ...baseInput })).toBe(true)
  })

  test('returns true when all config host keys reference admin-scoped configRequirements', () => {
    expect(
      hasProviderAllowedHostsFromConfig({
        ...baseInput,
        providerAllowedHostsFromConfig: ['base_url'],
        configRequirements: [{ key: 'base_url', scope: 'admin' }],
      }),
    ).toBe(true)
  })

  test('returns false when a config host key is missing from configRequirements', () => {
    expect(
      hasProviderAllowedHostsFromConfig({
        ...baseInput,
        providerAllowedHostsFromConfig: ['base_url'],
        configRequirements: [],
      }),
    ).toBe(false)
  })

  test('returns true when a config host key references a context-scoped requirement', () => {
    expect(
      hasProviderAllowedHostsFromConfig({
        ...baseInput,
        providerAllowedHostsFromConfig: ['base_url'],
        configRequirements: [{ key: 'base_url', scope: 'context' }],
      }),
    ).toBe(true)
  })
})

describe('hasProviderManifestPermission (fix 2: providerAllowedHostsFromConfig)', () => {
  test('returns true when both providerAllowedHosts and providerAllowedHostsFromConfig are empty', () => {
    expect(hasProviderManifestPermission({ ...baseInput })).toBe(true)
  })

  test('returns true when providerAllowedHosts is non-empty and http permission is present', () => {
    expect(
      hasProviderManifestPermission({
        ...baseInput,
        permissions: ['http'],
        providerAllowedHosts: ['example.com'],
      }),
    ).toBe(true)
  })

  test('returns false when providerAllowedHostsFromConfig is non-empty and no http or provider.task permission', () => {
    // fix 2: providerAllowedHostsFromConfig alone must also require http or provider.task
    expect(
      hasProviderManifestPermission({
        ...baseInput,
        permissions: [],
        providerAllowedHosts: [],
        providerAllowedHostsFromConfig: ['base_url'],
      }),
    ).toBe(false)
  })

  test('returns true when providerAllowedHostsFromConfig is non-empty and http permission is present', () => {
    expect(
      hasProviderManifestPermission({
        ...baseInput,
        permissions: ['http'],
        providerAllowedHosts: [],
        providerAllowedHostsFromConfig: ['base_url'],
      }),
    ).toBe(true)
  })
})

describe('hasRequiredMainForManifest (fix 1: attachmentTransformers count)', () => {
  test('returns false for mcp-only manifest with no runtime contributions (no main required)', () => {
    // mcp-only with zero contributions: main must be absent (returns true when main is absent)
    expect(
      hasRequiredMainForManifest({
        ...baseInput,
        main: undefined,
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
      }),
    ).toBe(true)
  })

  test('returns false (requires main) for mcp + attachmentTransformers manifest without main', () => {
    // fix 1: attachmentTransformers count must be included in runtimeContributionCount
    // so this manifest is NOT mcp-only and must have main
    expect(
      hasRequiredMainForManifest({
        ...baseInput,
        main: undefined,
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        contributes: { ...baseInput.contributes, attachmentTransformers: ['my_transformer'] },
      }),
    ).toBe(false)
  })

  test('returns true (main present satisfies) for mcp + attachmentTransformers manifest with main', () => {
    expect(
      hasRequiredMainForManifest({
        ...baseInput,
        main: 'index.ts',
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
        contributes: { ...baseInput.contributes, attachmentTransformers: ['my_transformer'] },
      }),
    ).toBe(true)
  })
})
