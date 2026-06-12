// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolExecutionOptions } from 'ai'

import factory from '../../plugins/audio-transcribe/index.js'
import manifest from '../../plugins/audio-transcribe/plugin.json'
import { describeApiFailure, resolveConfig } from '../../plugins/audio-transcribe/transcription.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type {
  AttachmentTransformResult,
  PluginAttachmentFacade,
  PluginAttachmentRecord,
  PluginAttachmentTransformer,
  PluginPromptFragment,
  PluginTool,
  PluginToolRuntimeContext,
} from '../../src/plugins/types.js'
import { pluginManifestSchema } from '../../src/plugins/types.js'

function createMockLogger(): PluginLogger {
  return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
}

type AdminConfigOverrides = {
  apiKey?: string | undefined
  baseUrl?: string | undefined
  model?: string | undefined
}

function createMockContext(
  overrides: {
    config?: AdminConfigOverrides
    httpFetch?: (url: string, init?: RequestInit) => Promise<Response>
    noProviderRuntime?: boolean
  } = {},
): {
  ctx: PluginContext
  registeredTool: { value: PluginTool | undefined }
  registeredFragment: { value: PluginPromptFragment | undefined }
  registeredTransformer: { value: PluginAttachmentTransformer | undefined }
} {
  const registeredTool: { value: PluginTool | undefined } = { value: undefined }
  const registeredFragment: { value: PluginPromptFragment | undefined } = { value: undefined }
  const registeredTransformer: { value: PluginAttachmentTransformer | undefined } = { value: undefined }

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTool.value = tool
    },
    registerPromptFragment: (fragment: PluginPromptFragment) => {
      registeredFragment.value = fragment
    },
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerAttachmentTransformer: (transformer: PluginAttachmentTransformer) => {
      registeredTransformer.value = transformer
    },
    registerTaskProviderType: () => {},
  }

  const config: AdminConfigOverrides = overrides.config ?? {}
  const apiKey: string | undefined = 'apiKey' in config ? config.apiKey : 'test-api-key'

  const ctx: PluginContext = {
    pluginId: 'audio-transcribe',
    contextId: '__system__',
    permissions: new Set(['http', 'attachments.read', 'storage']),
    kv: { get: () => undefined, set: () => {}, delete: () => {}, list: () => [] },
    log: createMockLogger(),
    registration,
    providerRuntime:
      overrides.noProviderRuntime === true
        ? undefined
        : {
            httpFetch: overrides.httpFetch ?? mock(),
            allowedHosts: new Set(['api.openai.com', 'api.groq.com']),
            logger: createMockLogger(),
          },
    adminConfig: {
      get: (key: string) => {
        if (key === 'api_key') return apiKey
        if (key === 'base_url') return config.baseUrl
        if (key === 'model') return config.model
        return undefined
      },
    },
  }

  return { ctx, registeredTool, registeredFragment, registeredTransformer }
}

type MockAttachments = { facade: PluginAttachmentFacade; readMock: ReturnType<typeof mock> }

function createMockAttachments(
  overrides: {
    filename?: string
    mimeType?: string | undefined
    size?: number
    bytes?: Buffer
    throwOnRead?: Error
    origin?: 'voice' | 'file'
  } = {},
): MockAttachments {
  const filename = overrides.filename ?? 'voice.ogg'
  const mimeType: string | undefined = 'mimeType' in overrides ? overrides.mimeType : 'audio/ogg'
  const bytes = overrides.bytes ?? Buffer.from('fake-audio-bytes')
  const size = overrides.size ?? bytes.byteLength
  const readMock = mock((attachmentId: string) => {
    if (overrides.throwOnRead !== undefined) return Promise.reject(overrides.throwOnRead)
    return Promise.resolve({
      record: {
        attachmentId,
        filename,
        mimeType,
        size,
        createdAt: '2026-01-01T00:00:00.000Z',
        ...(overrides.origin === undefined ? {} : { origin: overrides.origin }),
      },
      bytes,
    })
  })
  return { facade: { read: readMock }, readMock }
}

type RuntimeOverrides = {
  rateAllowed?: boolean
  retryAfterSec?: number
  attachments?: PluginAttachmentFacade
  kvBacking?: Map<string, string>
  adminApiKey?: string | undefined
  contextApiKey?: string | undefined
  contextModel?: string | undefined
  adminModel?: string | undefined
  adminBaseUrl?: string | undefined
}

function createMockRuntimeContext(overrides: RuntimeOverrides = {}): PluginToolRuntimeContext {
  const notImplemented = (): Promise<never> => Promise.reject(new Error('not implemented'))
  const kvBacking = overrides.kvBacking ?? new Map<string, string>()
  return {
    pluginId: 'audio-transcribe',
    storageContextId: 'test-context',
    chatUserId: 'test-user',
    taskProvider: {
      getTask: () => notImplemented(),
      listTasks: () => notImplemented(),
      searchTasks: () => notImplemented(),
      createTask: () => notImplemented(),
      updateTask: () => notImplemented(),
    },
    kv: {
      get: (key: string) => kvBacking.get(key),
      set: (key: string, value: string) => {
        kvBacking.set(key, value)
      },
      delete: (key: string) => {
        kvBacking.delete(key)
      },
      list: (prefix?: string) => {
        const entries = Array.from(kvBacking.entries()).map(([key, value]) => ({ key, value }))
        if (prefix === undefined) return entries
        return entries.filter((e) => e.key.startsWith(prefix))
      },
    },
    rateLimit: {
      check: () => ({
        allowed: overrides.rateAllowed ?? true,
        retryAfterSec: overrides.retryAfterSec,
      }),
    },
    adminConfig: {
      get: (key: string) => {
        if (key === 'api_key') {
          return 'adminApiKey' in overrides ? overrides.adminApiKey : 'test-api-key'
        }
        if (key === 'base_url') return overrides.adminBaseUrl
        if (key === 'model') return overrides.adminModel
        return undefined
      },
    },
    contextConfig: {
      get: (key: string) => {
        if (key === 'api_key') return overrides.contextApiKey
        if (key === 'model') return overrides.contextModel
        return undefined
      },
    },
    attachments: overrides.attachments ?? createMockAttachments().facade,
  }
}

function createMockOptions(): ToolExecutionOptions {
  return { toolCallId: 'test-call-id', messages: [] }
}

function assertTransformFailed(
  result: AttachmentTransformResult,
): asserts result is Extract<AttachmentTransformResult, { ok: false }> {
  assert(!result.ok, 'expected transform result to have ok: false')
}

function makeVoiceRecord(): PluginAttachmentRecord {
  return {
    attachmentId: 'att_voice1',
    filename: 'voice.ogg',
    mimeType: 'audio/ogg',
    size: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    origin: 'voice',
  }
}

describe('audio-transcribe plugin', () => {
  // ── manifest validation ──────────────────────────────────────────────────

  test('v2 plugin.json manifest parses correctly', () => {
    const parsed = pluginManifestSchema.parse(manifest)
    expect(parsed.version).toBe('2.0.0')
    expect(parsed.contributes.attachmentTransformers).toContain('audio-transcribe')
    expect(parsed.configRequirements.map((r) => `${r.key}:${r.scope}`)).toContain('api_key:admin')
    expect(parsed.configRequirements.map((r) => `${r.key}:${r.scope}`)).toContain('api_key:context')
    expect(parsed.providerAllowedHostsFromConfig).toContain('base_url')
  })

  // ── registration ─────────────────────────────────────────────────────────

  test('activates and registers the transcribe tool and prompt fragment', () => {
    const { ctx, registeredTool, registeredFragment } = createMockContext()
    const instance = factory()
    void instance.activate(ctx)

    expect(registeredTool.value).toBeDefined()
    expect(registeredTool.value!.name).toBe('transcribe')
    expect(registeredTool.value!.description).toContain('audio attachment')

    expect(registeredFragment.value).toBeDefined()
    expect(registeredFragment.value!.name).toBe('audio-transcribe-hint')
    expect(typeof registeredFragment.value!.content).toBe('string')
  })

  test('registers the attachment transformer', () => {
    const { ctx, registeredTransformer } = createMockContext()
    const instance = factory()
    void instance.activate(ctx)

    const t = registeredTransformer.value
    expect(t).toBeDefined()
    expect(t!.name).toBe('audio-transcribe')
    expect(t!.origins).toEqual(['voice'])
    expect(t!.mimePrefixes).toEqual(['audio/'])
    expect(t!.filenameExtensions).toContain('.ogg')
    expect(t!.filenameExtensions).toContain('.opus')
    expect(t!.filenameExtensions).toContain('.mp3')
    expect(t!.filenameExtensions).toContain('.m4a')
    expect(t!.filenameExtensions).toContain('.wav')
    expect(t!.filenameExtensions).toContain('.webm')
    expect(t!.timeoutMs).toBe(60_000)
  })

  // ── tool: happy path & caching ────────────────────────────────────────────

  test('transcribes audio and returns text + language + durationSec', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello world', language: 'en', duration: 1.5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result).toEqual({ text: 'hello world', language: 'en', durationSec: 1.5 })
  })

  test('returns cached transcript on second call without invoking httpFetch', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'cached', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)
    const tool = registeredTool.value!

    const kvBacking = new Map<string, string>()
    await tool.execute({ attachment_id: 'att_1' }, createMockRuntimeContext({ kvBacking }), createMockOptions())
    const second = await tool.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ kvBacking }),
      createMockOptions(),
    )

    expect(second).toEqual({ text: 'cached', language: 'en', durationSec: 1 })
    expect(mockHttpFetch).toHaveBeenCalledTimes(1)
  })

  // ── tool: rate-limiting & validation ─────────────────────────────────────

  test('returns rate_limited error without touching attachments or httpFetch', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { facade, readMock } = createMockAttachments()
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ rateAllowed: false, retryAfterSec: 30, attachments: facade }),
      createMockOptions(),
    )

    expect(result).toEqual({ error: 'rate_limited', retryAfterSec: 30 })
    expect(readMock).not.toHaveBeenCalled()
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  // ── tool: attachment loading ──────────────────────────────────────────────

  test('returns attachment_not_found when attachments.read throws', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_missing' },
      createMockRuntimeContext({
        attachments: createMockAttachments({ throwOnRead: new Error('attachment_not_found') }).facade,
      }),
      createMockOptions(),
    )

    expect(result).toEqual({ error: 'attachment_not_found' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('tool still rejects non-audio mime types', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        attachments: createMockAttachments({ mimeType: 'application/pdf', filename: 'doc.pdf' }).facade,
      }),
      createMockOptions(),
    )

    expect(result).toEqual({ error: 'unsupported_media_type', mimeType: 'application/pdf' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('tool accepts a MIME-less attachment with a known audio extension', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        attachments: createMockAttachments({ mimeType: undefined, filename: 'note.m4a' }).facade,
      }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ text: 'hello' })
  })

  test('rejects audio files over 24 MiB', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tooBig = 25 * 1024 * 1024
    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        attachments: createMockAttachments({ size: tooBig, bytes: Buffer.from('x') }).facade,
      }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'audio_too_large', sizeBytes: tooBig, maxBytes: 24 * 1024 * 1024 })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  // ── tool: API errors ─────────────────────────────────────────────────────

  test('returns api_error on non-200 response', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('upstream limit hit', { status: 429 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'api_error', status: 429, message: 'upstream limit hit' })
  })

  test('returns timeout error on AbortError', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const mockHttpFetch = mock().mockRejectedValue(abortError)
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'timeout', message: 'The operation was aborted' })
  })

  test('returns network_error on fetch failure', async () => {
    const mockHttpFetch = mock().mockRejectedValue(new Error('Connection refused'))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'network_error', message: 'Connection refused' })
  })

  // ── tool: config resolution ───────────────────────────────────────────────

  test('uses Groq base_url and model when admin sets them', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'привет', language: 'ru', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({
      httpFetch: mockHttpFetch,
      config: { baseUrl: 'https://api.groq.com/openai', model: 'whisper-large-v3-turbo' },
    })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminBaseUrl: 'https://api.groq.com/openai', adminModel: 'whisper-large-v3-turbo' }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('returns not_configured when api_key is missing in both admin and context', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({
      httpFetch: mockHttpFetch,
      config: { apiKey: undefined },
    })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminApiKey: undefined }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'not_configured' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('context api_key overrides admin api_key at execute time', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ contextApiKey: 'ctx-key', adminApiKey: 'admin-key' }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer ctx-key' } }),
    )
  })

  test('admin api_key applies when context unset (BYO default)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminApiKey: 'admin-key' }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer admin-key' } }),
    )
  })

  test('context model overrides admin model (resolveConfig)', () => {
    // Test config resolution directly via the exported resolveConfig function
    const runtimeContext = createMockRuntimeContext({ contextModel: 'ctx-model', adminModel: 'admin-model' })
    const { model } = resolveConfig(runtimeContext)
    expect(model).toBe('ctx-model')
  })

  test('key changes apply without re-activation (execute-time read)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    // After activation, pass a runtime context with a key — must work without restart
    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminApiKey: 'late-key' }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ text: 'hello' })
  })

  // ── cache pruning ─────────────────────────────────────────────────────────

  test('cache write prunes entries older than 30 days', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'new', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    // Pre-seed an old entry (older than 30 days)
    const kvBacking = new Map<string, string>()
    kvBacking.set('transcript:att_old', JSON.stringify({ text: 'old', cachedAt: '2020-01-01T00:00:00.000Z' }))

    await registeredTool.value!.execute(
      { attachment_id: 'att_new' },
      createMockRuntimeContext({ kvBacking }),
      createMockOptions(),
    )

    // Old entry should be pruned
    expect(kvBacking.has('transcript:att_old')).toBe(false)
    // New entry should be present with cachedAt
    const newEntry = kvBacking.get('transcript:att_new')
    expect(newEntry).toBeDefined()
    const parsedEntry: unknown = JSON.parse(newEntry!)
    expect(parsedEntry).toMatchObject({ text: 'new' })
    expect(parsedEntry).toHaveProperty('cachedAt')
  })

  test('legacy cache entries without cachedAt are pruned on next write', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'new', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const kvBacking = new Map<string, string>()
    // Legacy entry without cachedAt
    kvBacking.set('transcript:att_legacy', JSON.stringify({ text: 'legacy' }))

    await registeredTool.value!.execute(
      { attachment_id: 'att_new2' },
      createMockRuntimeContext({ kvBacking }),
      createMockOptions(),
    )

    // Legacy entry without cachedAt should be pruned
    expect(kvBacking.has('transcript:att_legacy')).toBe(false)
  })

  // ── transformer: happy path & caching ────────────────────────────────────

  test('transform returns ok text via the shared pipeline', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello world', language: 'en', duration: 1.5 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({
      adminApiKey: 'test-api-key',
      attachments: createMockAttachments({ filename: 'voice.ogg', mimeType: 'audio/ogg', origin: 'voice' }).facade,
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    expect(result).toMatchObject({ ok: true, text: 'hello world', meta: { language: 'en', durationSec: 1.5 } })
  })

  test('cached transcript is reused by the transformer (httpFetch not called)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'original', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const kvBacking = new Map<string, string>()
    // Pre-seed a valid cache entry
    kvBacking.set(
      'transcript:att_voice1',
      JSON.stringify({ text: 'cached text', language: 'en', durationSec: 2.0, cachedAt: new Date().toISOString() }),
    )

    const runtimeContext = createMockRuntimeContext({ kvBacking })
    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    expect(result).toMatchObject({ ok: true, text: 'cached text' })
    // httpFetch should not have been called since we got a cache hit
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  // ── transformer: not configured ──────────────────────────────────────────

  test('transform reports not configured when no key is set anywhere', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({ adminApiKey: undefined })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    assertTransformFailed(result)
    expect(result.reason).toContain('not configured')
  })

  // ── transformer: failure reasons ─────────────────────────────────────────

  test('transform failure reason for oversize record is terse', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const tooBig = 25 * 1024 * 1024
    const record = { ...makeVoiceRecord(), size: tooBig }
    const runtimeContext = createMockRuntimeContext({
      adminApiKey: 'test-api-key',
      attachments: createMockAttachments({ size: tooBig, bytes: Buffer.from('x') }).facade,
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    expect(result).toMatchObject({ ok: false, reason: 'file too large (max 24 MiB)' })
  })

  test('transform failure reason for rate-limited context contains "rate limited"', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({
      adminApiKey: 'test-api-key',
      rateAllowed: false,
      retryAfterSec: 30,
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    assertTransformFailed(result)
    expect(result.reason).toContain('rate limited')
  })

  // ── fix 1: cache-before-rate-limit ───────────────────────────────────────

  test('cache hit is returned even when the context is rate-limited (quota not consumed)', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    // Pre-seed the cache so the tool should return a cached result immediately
    const kvBacking = new Map<string, string>()
    kvBacking.set(
      'transcript:att_cached',
      JSON.stringify({ text: 'cached result', language: 'en', durationSec: 2, cachedAt: new Date().toISOString() }),
    )

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_cached' },
      // Rate-limited: without the fix this would return rate_limited before checking cache
      createMockRuntimeContext({ rateAllowed: false, retryAfterSec: 60, kvBacking }),
      createMockOptions(),
    )

    // Must return cached transcript, NOT a rate_limited error
    expect(result).toEqual({ text: 'cached result', language: 'en', durationSec: 2 })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  // ── fix 2: FormData body assertions ─────────────────────────────────────

  test('happy-path tool call sends correct FormData: model, file, and language fields', async () => {
    const capturedInits: (RequestInit | undefined)[] = []
    const mockHttpFetch = mock((_url: string, init?: RequestInit) => {
      capturedInits.push(init)
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'bonjour', language: 'fr', duration: 1.2 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1', language: 'fr' },
      createMockRuntimeContext({ adminModel: 'whisper-1' }),
      createMockOptions(),
    )

    expect(capturedInits).toHaveLength(1)
    const body = capturedInits.at(0)?.body
    assert(body instanceof FormData, 'expected request body to be FormData')
    expect(body.get('model')).toBe('whisper-1')
    expect(body.get('file')).toBeInstanceOf(Blob)
    expect(body.get('language')).toBe('fr')
  })

  // ── fix 4: httpFetch-undefined (providerRuntime: undefined) ──────────────

  test('returns not_configured when providerRuntime is undefined (distinct from missing api_key)', async () => {
    const { ctx, registeredTool } = createMockContext({ noProviderRuntime: true })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminApiKey: 'some-key' }),
      createMockOptions(),
    )

    // providerRuntime: undefined → httpFetch is undefined → not_configured
    expect(result).toMatchObject({ error: 'not_configured' })
  })

  // ── fix 5: timeout reason distinction ───────────────────────────────────

  test('describeApiFailure maps timeout error to "transcription timed out — try again"', () => {
    expect(describeApiFailure({ error: 'timeout' })).toBe('transcription timed out — try again')
  })

  test('describeApiFailure maps non-timeout, non-config errors to "transcription service error"', () => {
    expect(describeApiFailure({ error: 'api_error' })).toBe('transcription service error')
    expect(describeApiFailure({ error: 'network_error' })).toBe('transcription service error')
    expect(describeApiFailure({ error: 'bad_response' })).toBe('transcription service error')
  })
})
