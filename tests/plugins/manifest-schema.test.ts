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

  test('accepts an explicit user scope', () => {
    const parsed = pluginManifestSchema.parse({
      ...base,
      providerConfigSchema: [{ key: 'api_key', label: 'Key', required: true, sensitive: true, scope: 'user' }],
    })
    expect(parsed.providerConfigSchema[0]?.scope).toBe('user')
  })
})
