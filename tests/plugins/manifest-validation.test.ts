// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  hasAttachmentTransformerPermission,
  hasProviderAllowedHostsFromConfig,
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

  test('returns false when a config host key references a context-scoped requirement', () => {
    expect(
      hasProviderAllowedHostsFromConfig({
        ...baseInput,
        providerAllowedHostsFromConfig: ['base_url'],
        configRequirements: [{ key: 'base_url', scope: 'context' }],
      }),
    ).toBe(false)
  })
})
