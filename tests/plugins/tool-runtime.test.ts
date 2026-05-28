// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { saveAttachment } from '../../src/attachments/store.js'
import { buildPluginToolRuntimeContext, type PluginToolSetRuntime } from '../../src/plugins/tool-runtime.js'
import type { PluginManifest } from '../../src/plugins/types.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    description: 'Test',
    apiVersion: 1,
    main: 'index.ts',
    contributes: { tools: [], promptFragments: [], commands: [], jobs: [], configKeys: [], taskProviderTypes: [] },
    permissions: [],
    defaultEnabled: false,
    requiredTaskCapabilities: [],
    requiredChatCapabilities: [],
    configRequirements: [],
    providerCapabilities: [],
    providerConfigSchema: [],
    providerAllowedHosts: [],
    activationTimeoutMs: 5000,
    ...overrides,
  } as PluginManifest
}

function makeRuntime(overrides: Partial<PluginToolSetRuntime> = {}): PluginToolSetRuntime {
  return {
    provider: createMockProvider(),
    storageContextId: 'ctx-1',
    chatUserId: 'user-1',
    ...overrides,
  }
}

describe('buildPluginToolRuntimeContext', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('rateLimit', () => {
    test('provides rateLimit on the runtime context', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      expect(ctx.rateLimit).toBeDefined()
      expect(typeof ctx.rateLimit.check).toBe('function')
    })

    test('allows requests within the rate limit', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      const result = ctx.rateLimit.check('actor-1')
      expect(result.allowed).toBe(true)
    })

    test('denies requests when rate limit is exceeded', () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest(), makeRuntime())
      let lastResult: { allowed: boolean; retryAfterSec?: number } = { allowed: true }
      for (let i = 0; i < 21; i++) {
        lastResult = ctx.rateLimit.check('actor-1')
      }
      expect(lastResult.allowed).toBe(false)
      expect(lastResult.retryAfterSec).toBeDefined()
      expect(lastResult.retryAfterSec!).toBeGreaterThan(0)
    })
  })

  describe('attachments facade', () => {
    test('provides attachments on the runtime context', () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime(),
      )
      expect(ctx.attachments).toBeDefined()
      expect(typeof ctx.attachments.read).toBe('function')
    })

    test('throws when plugin lacks attachments.read permission', async () => {
      const ctx = buildPluginToolRuntimeContext('test-plugin', makeManifest({ permissions: [] }), makeRuntime())
      await expect(ctx.attachments.read('att_anything')).rejects.toThrow(/attachments\.read/u)
    })

    test('returns record metadata and bytes for an attachment in the current context', async () => {
      const saved = await saveAttachment({
        contextId: 'ctx-1',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio-bytes'),
        mimeType: 'audio/ogg',
        size: 11,
      })

      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )

      const result = await ctx.attachments.read(saved.attachmentId)
      expect(result.record.filename).toBe('voice.ogg')
      expect(result.record.mimeType).toBe('audio/ogg')
      expect(result.record.size).toBe(11)
      expect(result.bytes.toString()).toBe('audio-bytes')
    })

    test('throws attachment_not_found for unknown ids', async () => {
      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-1' }),
      )
      await expect(ctx.attachments.read('att_does_not_exist')).rejects.toThrow(/attachment_not_found/u)
    })

    test('cannot access an attachment from a different storage context', async () => {
      const saved = await saveAttachment({
        contextId: 'ctx-A',
        sourceProvider: 'telegram',
        filename: 'secret.ogg',
        status: 'available',
        content: Buffer.from('secret-bytes'),
        mimeType: 'audio/ogg',
        size: 12,
      })

      const ctx = buildPluginToolRuntimeContext(
        'test-plugin',
        makeManifest({ permissions: ['attachments.read'] }),
        makeRuntime({ storageContextId: 'ctx-B' }),
      )

      await expect(ctx.attachments.read(saved.attachmentId)).rejects.toThrow(/attachment_not_found/u)
    })
  })
})
