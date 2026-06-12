// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { buildDynamicHosts } from '../../src/plugins/dynamic-hosts.js'
import { setPluginAdminConfig } from '../../src/plugins/store.js'
import { PLUGIN_API_VERSION } from '../../src/plugins/types.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test',
    version: '1.0.0',
    description: 'Test',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: [],
    },
    permissions: ['http'],
    defaultEnabled: false,
    activationTimeoutMs: 5000,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerTraits: [],
    providerConfigSchema: [],
    providerContextConfigSchema: [],
    providerAllowedHosts: [],
    ...overrides,
  }
}

describe('buildDynamicHosts', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('returns empty set when providerAllowedHostsFromConfig is not declared', () => {
    const thunk = buildDynamicHosts(makeManifest())
    expect(thunk().size).toBe(0)
  })

  test('returns empty set when declared keys have no admin config set', () => {
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    expect(thunk().size).toBe(0)
  })

  test('resolves a full URL value to its hostname', () => {
    setPluginAdminConfig('test-plugin', 'base_url', 'http://whisper.lan:9000', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    const hosts = thunk()
    expect(hosts.has('whisper.lan')).toBe(true)
    expect(hosts.size).toBe(1)
  })

  test('normalises hostnames to lowercase', () => {
    setPluginAdminConfig('test-plugin', 'base_url', 'https://Whisper.LAN/v1', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    expect(thunk().has('whisper.lan')).toBe(true)
  })

  test('skips blank config values', () => {
    setPluginAdminConfig('test-plugin', 'base_url', '   ', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    expect(thunk().size).toBe(0)
  })

  test('skips non-URL config values without throwing', () => {
    setPluginAdminConfig('test-plugin', 'base_url', 'not-a-url', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    expect(thunk().size).toBe(0)
  })

  test('skips an invalid URL with warn logging and still yields an empty set', () => {
    // mockLogger() in beforeEach silences the warn emitted by the catch block;
    // this test confirms the skip still yields an empty set so callers are not
    // disrupted by invalid operator config.
    setPluginAdminConfig('test-plugin', 'api_url', 'ht tp://invalid url', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['api_url'] }))
    expect(thunk().size).toBe(0)
  })

  test('is evaluated lazily — admin config set after thunk construction is reflected', () => {
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url'] }))
    // Before config is set: empty
    expect(thunk().size).toBe(0)
    // Set config after construction
    setPluginAdminConfig('test-plugin', 'base_url', 'http://whisper.lan', 'admin')
    // After config is set: host appears
    expect(thunk().has('whisper.lan')).toBe(true)
  })

  test('resolves multiple keys to multiple hosts', () => {
    setPluginAdminConfig('test-plugin', 'base_url', 'http://whisper.lan', 'admin')
    setPluginAdminConfig('test-plugin', 'extra_url', 'https://api.example.com', 'admin')
    const thunk = buildDynamicHosts(makeManifest({ providerAllowedHostsFromConfig: ['base_url', 'extra_url'] }))
    const hosts = thunk()
    expect(hosts.has('whisper.lan')).toBe(true)
    expect(hosts.has('api.example.com')).toBe(true)
    expect(hosts.size).toBe(2)
  })
})
