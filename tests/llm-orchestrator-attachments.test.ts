// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import assert from 'node:assert/strict'

import {
  resetBlobStoreForTesting,
  setBlobStoreForTesting,
  createInMemoryBlobStoreForTesting,
  saveAttachment,
} from '../src/attachments/index.js'
import { setCachedConfig } from '../src/cache.js'
import { toScopedContextId, toScopedThreadContextId } from '../src/chat/scoped-context.js'
import { buildUserTurnMessages } from '../src/llm-orchestrator-attachments.js'
import { contributionRegistry, resetContributionCollisionStateForTesting } from '../src/plugins/contributions.js'
import { pluginRegistry, resetPluginRegistryForTesting, setPluginEnabledForContext } from '../src/plugins/registry.js'
import type { DiscoveredPlugin, PluginManifest } from '../src/plugins/types.js'
import { PLUGIN_API_VERSION } from '../src/plugins/types.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

function makeTranscriberManifest(id = 'test-transcriber-plugin'): PluginManifest {
  return {
    id,
    name: 'Test Transcriber',
    version: '1.0.0',
    description: 'test',
    apiVersion: PLUGIN_API_VERSION,
    main: 'index.ts',
    contributes: {
      tools: [],
      promptFragments: [],
      commands: [],
      jobs: [],
      configKeys: [],
      taskProviderTypes: [],
      attachmentTransformers: ['voice-transcriber'],
    },
    permissions: ['attachments.read'],
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
  }
}

function makeDiscoveredPlugin(manifest: PluginManifest): DiscoveredPlugin {
  return {
    manifest,
    pluginDir: `/tmp/${manifest.id}`,
    entryPoint: `/tmp/${manifest.id}/index.ts`,
    manifestHash: `hash-${manifest.id}`,
  }
}

// Matches `<current_time>YYYY-MM-DD HH:MM (Weekday)</current_time>\nHello`
const TAG_THEN_HELLO = /^<current_time>\d{4}-\d{2}-\d{2} \d{2}:\d{2} \([A-Za-z]+\)<\/current_time>\nHello$/u

describe('llm-orchestrator-attachments', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    setBlobStoreForTesting(createInMemoryBlobStoreForTesting())
    resetPluginRegistryForTesting()
    resetContributionCollisionStateForTesting()
    contributionRegistry.deregister('test-transcriber-plugin')
  })

  afterEach(() => {
    contributionRegistry.deregister('test-transcriber-plugin')
    resetPluginRegistryForTesting()
    resetContributionCollisionStateForTesting()
    resetBlobStoreForTesting()
    delete process.env['S3_BUCKET']
    delete process.env['S3_ACCESS_KEY_ID']
    delete process.env['S3_SECRET_ACCESS_KEY']
  })

  describe('buildUserTurnMessages', () => {
    test('prepends a current_time tag when S3 is not configured', async () => {
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'user-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage.role).toBe('user')
      expect(modelMessage.content).toMatch(TAG_THEN_HELLO)
      // Same instant => model and history carry the identical tag + text.
      expect(historyMessage.content).toBe(modelMessage.content)
    })

    test('prepends the tag with no attachments even when S3 is configured', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-1', 'user-1', 'gpt-4o', 'Hello', [])

      expect(modelMessage.content).toMatch(TAG_THEN_HELLO)
      expect(historyMessage.content).toBe(modelMessage.content)
    })

    test('resolves the timezone from the config context, not chatUserId', async () => {
      // The timezone is stored under the (thread-stripped) config-context id, never the raw
      // chatUserId. Asia/Karachi is UTC+5 (no DST). Both calls share one chatUserId, so a
      // regression that resolved by chatUserId — or always fell back to UTC — would make the
      // two tags identical.
      setCachedConfig('ctx-tz', 'timezone', 'Asia/Karachi')
      const utcResult = await buildUserTurnMessages('ctx-utc', 'user-1', 'gpt-4o', 'Hello', [])
      const tzResult = await buildUserTurnMessages('ctx-tz', 'user-1', 'gpt-4o', 'Hello', [])

      expect(utcResult.modelMessage.content).toMatch(TAG_THEN_HELLO)
      // The configured-timezone tag must also match the full pattern (which enforces two-digit HH:MM).
      expect(tzResult.modelMessage.content).toMatch(TAG_THEN_HELLO)

      const utcContent = utcResult.modelMessage.content
      const tzContent = tzResult.modelMessage.content
      assert(typeof utcContent === 'string', 'expected string content')
      assert(typeof tzContent === 'string', 'expected string content')
      expect(utcContent).not.toBe(tzContent)
    })

    test('resolves the timezone from the thread-stripped group context inside a group thread', async () => {
      // Group timezone lives under the thread-stripped group config context, but the live turn
      // runs in a thread-scoped storage context. The tag must still honor the group timezone.
      const groupConfigContextId = toScopedContextId({ platformInstanceId: 'inst-1', nativeContextId: 'group-1' })
      const threadContextId = toScopedThreadContextId({
        platformInstanceId: 'inst-1',
        nativeContextId: 'group-1',
        threadId: 'thread-1',
      })
      // Asia/Karachi is UTC+5 (no DST).
      setCachedConfig(groupConfigContextId, 'timezone', 'Asia/Karachi')

      const tzResult = await buildUserTurnMessages(threadContextId, 'user-1', 'gpt-4o', 'Hello', [])
      // A sibling group with no configured timezone falls back to UTC.
      const utcResult = await buildUserTurnMessages(
        toScopedThreadContextId({ platformInstanceId: 'inst-1', nativeContextId: 'group-2', threadId: 'thread-1' }),
        'user-1',
        'gpt-4o',
        'Hello',
        [],
      )

      expect(tzResult.modelMessage.content).toMatch(TAG_THEN_HELLO)
      const tzContent = tzResult.modelMessage.content
      const utcContent = utcResult.modelMessage.content
      assert(typeof tzContent === 'string', 'expected string content')
      assert(typeof utcContent === 'string', 'expected string content')
      // +5h offset shifts the hour: a regression that ignored the group timezone (always UTC)
      // inside a thread would make these equal.
      expect(tzContent).not.toBe(utcContent)
    })

    test('audio attachments never become file parts for multimodal models', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const savedAudio = await saveAttachment({
        contextId: 'ctx-a',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-a', 'u1', 'gpt-4o', 'listen', [savedAudio.attachmentId])
      assert(Array.isArray(modelMessage.content), 'expected multimodal content parts array')
      const parts = modelMessage.content as { type: string }[]
      expect(parts.some((p) => p.type === 'file')).toBe(false)
    })

    test('multimodal text part includes the attachment lines', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const savedImage = await saveAttachment({
        contextId: 'ctx-b',
        sourceProvider: 'telegram',
        filename: 'pic.png',
        status: 'available',
        content: Buffer.from('png'),
        mimeType: 'image/png',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-b', 'u1', 'gpt-4o', 'see', [savedImage.attachmentId])
      assert(Array.isArray(modelMessage.content), 'expected multimodal content parts array')
      const parts = modelMessage.content as { type: string; text?: string }[]
      const textPart = parts.find((p) => p.type === 'text')
      expect(textPart?.text).toContain(`[User attached ${savedImage.attachmentId}: pic.png]`)
    })

    test('text-only and multimodal paths carry identical attachment lines', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-c',
        sourceProvider: 'telegram',
        filename: 'doc.pdf',
        status: 'available',
        content: Buffer.from('pdf'),
        mimeType: 'application/pdf',
      })
      const textOnlyResult = await buildUserTurnMessages('ctx-c', 'u1', 'small-model', 'read', [saved.attachmentId])
      const multi = await buildUserTurnMessages('ctx-c', 'u1', 'gpt-4o', 'read', [saved.attachmentId])
      assert(typeof textOnlyResult.modelMessage.content === 'string', 'expected string content for text-only model')
      assert(Array.isArray(multi.modelMessage.content), 'expected multimodal content parts array')
      const parts = multi.modelMessage.content as { type: string; text?: string }[]
      const textPart = parts.find((p) => p.type === 'text')
      expect(textPart?.text).toBe(textOnlyResult.modelMessage.content)
    })

    test('without active transformer plugins, attachment lines pass through unchanged', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-d',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('a'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })
      const { modelMessage, historyMessage } = await buildUserTurnMessages('ctx-d', 'u1', 'small-model', 'hi', [
        saved.attachmentId,
      ])
      assert(typeof modelMessage.content === 'string', 'expected string content for text-only model')
      assert(typeof historyMessage.content === 'string', 'expected string content for history message')
      expect(modelMessage.content).toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
      expect(historyMessage.content).toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
    })

    // Fix 1: pass-through line sanitizes brackets in filename
    test('pass-through attachment line sanitizes bracket characters in filename', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-sanitize',
        sourceProvider: 'telegram',
        filename: 'weird[1].ogg',
        status: 'available',
        content: Buffer.from('a'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-sanitize', 'u1', 'small-model', 'hi', [
        saved.attachmentId,
      ])
      assert(typeof modelMessage.content === 'string', 'expected string content')
      // filename brackets are sanitized; only the closing ] of the outer bracket structure remains
      const line = modelMessage.content.split('\n').find((l) => l.startsWith('[User attached'))
      expect(line).toBeDefined()
      expect(line).toContain('weird(1).ogg')
      // Exactly one ] at the end of the line
      expect(line!.indexOf(']')).toBe(line!.length - 1)
    })

    // Fix 4: \n\n separator between attachment lines and user text
    test('attachment lines and user text are separated by a blank line', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-sep',
        sourceProvider: 'telegram',
        filename: 'doc.pdf',
        status: 'available',
        content: Buffer.from('pdf'),
        mimeType: 'application/pdf',
      })
      const { modelMessage } = await buildUserTurnMessages('ctx-sep', 'u1', 'small-model', 'check this', [
        saved.attachmentId,
      ])
      assert(typeof modelMessage.content === 'string', 'expected string content')
      // The content must contain a blank line before the user text
      expect(modelMessage.content).toContain('\n\ncheck this')
    })

    // Fix 3: integration through buildUserTurnMessages with a registered transformer
    test('active transformer plugin line appears in modelMessage and truncated form in historyMessage', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const manifest = makeTranscriberManifest()
      pluginRegistry.registerDiscovered(makeDiscoveredPlugin(manifest))
      pluginRegistry.markActive(manifest.id)
      contributionRegistry.register(
        manifest.id,
        {
          tools: [],
          promptFragments: [],
          attachmentTransformers: [
            {
              name: 'voice-transcriber',
              mimePrefixes: ['audio/'],
              origins: ['voice'],
              transform: (): Promise<{ ok: true; text: string }> =>
                Promise.resolve({ ok: true as const, text: 'hello from transform' }),
            },
          ],
        },
        manifest,
      )
      setPluginEnabledForContext(manifest.id, 'ctx-integration', true)

      const saved = await saveAttachment({
        contextId: 'ctx-integration',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })

      const { modelMessage, historyMessage } = await buildUserTurnMessages(
        'ctx-integration',
        'u1',
        'small-model',
        'listen',
        [saved.attachmentId],
      )

      assert(typeof modelMessage.content === 'string', 'expected string content for model message')
      assert(typeof historyMessage.content === 'string', 'expected string content for history message')

      // modelMessage contains the transformer's output line
      expect(modelMessage.content).toContain('"hello from transform"')
      // historyMessage contains the truncated [User attached ...] form
      expect(historyMessage.content).toContain(
        `[User attached ${saved.attachmentId}: voice.ogg — "hello from transform"]`,
      )
      // modelMessage does NOT contain the raw [User attached ...] form (the transform replaced it)
      expect(modelMessage.content).not.toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
    })

    // Fix 1 (voice carry-over): a voice attachment mentioned by id in a LATER turn (newAttachmentIds=[])
    // must still get the transformer line, not the plain [User attached ...] pass-through.
    test('voice attachment mentioned in a later turn receives transformer line, not plain pass-through', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const manifest = makeTranscriberManifest('carry-over-plugin')
      pluginRegistry.registerDiscovered(makeDiscoveredPlugin(manifest))
      pluginRegistry.markActive(manifest.id)
      contributionRegistry.register(
        manifest.id,
        {
          tools: [],
          promptFragments: [],
          attachmentTransformers: [
            {
              name: 'voice-transcriber',
              mimePrefixes: ['audio/'],
              origins: ['voice'],
              transform: (): Promise<{ ok: true; text: string }> =>
                Promise.resolve({ ok: true as const, text: 'carry-over transcript' }),
            },
          ],
        },
        manifest,
      )
      setPluginEnabledForContext(manifest.id, 'ctx-carryover', true)

      const saved = await saveAttachment({
        contextId: 'ctx-carryover',
        sourceProvider: 'telegram',
        filename: 'voice.ogg',
        status: 'available',
        content: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        origin: 'voice',
      })

      // First turn: warms the KV cache (newAttachmentIds includes the id)
      await buildUserTurnMessages('ctx-carryover', 'u1', 'small-model', 'listen', [saved.attachmentId])

      // Second turn: newAttachmentIds=[] but text mentions the attachment id — carry-over
      const { modelMessage } = await buildUserTurnMessages(
        'ctx-carryover',
        'u1',
        'small-model',
        `what did ${saved.attachmentId} say`,
        [],
      )

      assert(typeof modelMessage.content === 'string', 'expected string content')
      // Must contain the transformer line, not the plain [User attached ...] form
      expect(modelMessage.content).toContain('"carry-over transcript"')
      expect(modelMessage.content).not.toContain(`[User attached ${saved.attachmentId}: voice.ogg]`)
    })

    // Fix 4: text-only model with no transformers skips loadAttachmentRecords (fast path)
    test('text-only model with no active transformers still renders correct pass-through lines', async () => {
      process.env['S3_BUCKET'] = 'test'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'

      const saved = await saveAttachment({
        contextId: 'ctx-fastpath',
        sourceProvider: 'telegram',
        filename: 'doc.pdf',
        status: 'available',
        content: Buffer.from('pdf'),
        mimeType: 'application/pdf',
      })
      const { modelMessage, historyMessage } = await buildUserTurnMessages(
        'ctx-fastpath',
        'u1',
        'small-model',
        'read it',
        [saved.attachmentId],
      )
      assert(typeof modelMessage.content === 'string', 'expected string content')
      assert(typeof historyMessage.content === 'string', 'expected string content')
      // Both must contain the pass-through line
      expect(modelMessage.content).toContain(`[User attached ${saved.attachmentId}: doc.pdf]`)
      expect(historyMessage.content).toContain(`[User attached ${saved.attachmentId}: doc.pdf]`)
    })
  })
})
