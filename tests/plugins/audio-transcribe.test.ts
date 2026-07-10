// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ToolExecutionOptions } from 'ai'

import factory from '../../plugins/audio-transcribe/index.js'
import manifest from '../../plugins/audio-transcribe/plugin.json'
import {
  buildCacheKey,
  DEFAULT_MODEL,
  describeApiFailure,
  normalizeLanguage,
  normalizeModel,
  resolveConfig,
  writeCache,
} from '../../plugins/audio-transcribe/transcription.js'
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
  contextBaseUrl?: string | undefined
  contextModel?: string | undefined
  adminModel?: string | undefined
  adminBaseUrl?: string | undefined
  onRateCheck?: (actorId: string) => void
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
      check: (actorId: string) => {
        overrides.onRateCheck?.(actorId)
        return {
          allowed: overrides.rateAllowed ?? true,
          retryAfterSec: overrides.retryAfterSec,
        }
      },
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
        if (key === 'base_url') return overrides.contextBaseUrl
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
    expect(parsed.version).toBe('2.2.0')
    // Group-shared transcript cache: voice notes are not re-transcribed across a
    // group's sibling threads.
    expect(parsed.storageScope).toBe('group')
    expect(parsed.contributes.attachmentTransformers).toContain('audio-transcribe')
    expect(parsed.configRequirements.map((r) => `${r.key}:${r.scope}`)).toContain('api_key:admin')
    expect(parsed.configRequirements.map((r) => `${r.key}:${r.scope}`)).toContain('api_key:context')
    expect(parsed.configRequirements.map((r) => `${r.key}:${r.scope}`)).toContain('base_url:context')
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

  test('buildCacheKey: base key without language, distinct key with normalized language', () => {
    expect(buildCacheKey('att_1')).toBe('transcript:att_1')
    expect(buildCacheKey('att_1', undefined)).toBe('transcript:att_1')
    expect(buildCacheKey('att_1', 'ru')).toBe('transcript:att_1:lang:ru')
    // Invalid language normalizes away → base key (no injection of junk into the key).
    expect(buildCacheKey('att_1', 'not a lang!!')).toBe('transcript:att_1')
  })

  test('re-transcribe with explicit language re-runs even when a base transcript is cached', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'привет', language: 'ru', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const kvBacking = new Map<string, string>()
    // A wrong-language base transcript is already cached (e.g. from auto-transcription).
    kvBacking.set(
      'transcript:att_lang',
      JSON.stringify({ text: 'preevyet', language: 'en', durationSec: 1, cachedAt: new Date().toISOString() }),
    )

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_lang', language: 'ru' },
      createMockRuntimeContext({ kvBacking }),
      createMockOptions(),
    )

    // Must NOT return the stale cached English transcript — the explicit language forces a re-run.
    expect(mockHttpFetch).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ text: 'привет', language: 'ru', durationSec: 1 })
    // Stored under a language-specific key; the base entry is untouched.
    expect(kvBacking.has('transcript:att_lang:lang:ru')).toBe(true)
    // Base entry untouched — still holds the original (wrong) transcript.
    expect(kvBacking.get('transcript:att_lang')).toContain('preevyet')

    // A second identical-language call is a cache hit (no second network call).
    mockHttpFetch.mockClear()
    const second = await registeredTool.value!.execute(
      { attachment_id: 'att_lang', language: 'ru' },
      createMockRuntimeContext({ kvBacking }),
      createMockOptions(),
    )
    expect(mockHttpFetch).not.toHaveBeenCalled()
    expect(second).toEqual({ text: 'привет', language: 'ru', durationSec: 1 })
  })

  test('writeCache returns true on success and false when the KV write throws', () => {
    const store = new Map<string, string>()
    const okKv: PluginToolRuntimeContext['kv'] = {
      get: (k) => store.get(k),
      set: (k, v) => {
        store.set(k, v)
      },
      delete: (k) => {
        store.delete(k)
      },
      list: () => [],
    }
    expect(writeCache(okKv, 'transcript:ok', { text: 'hi' })).toBe(true)

    const denyingKv: PluginToolRuntimeContext['kv'] = {
      get: () => undefined,
      set: () => {
        throw new Error('storage denied')
      },
      delete: () => {},
      list: () => [],
    }
    expect(writeCache(denyingKv, 'transcript:bad', { text: 'hi' })).toBe(false)
  })

  test('rate limit is keyed by chatUserId (per-user), not storageContextId', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const seenActorIds: string[] = []
    await registeredTool.value!.execute(
      { attachment_id: 'att_user_key' },
      createMockRuntimeContext({
        onRateCheck: (actorId) => {
          seenActorIds.push(actorId)
        },
      }),
      createMockOptions(),
    )

    // storageContextId is 'test-context'; chatUserId is 'test-user'. Keying by
    // the group/thread context id would let one user starve a whole group.
    expect(seenActorIds).toEqual(['test-user'])
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
      createMockRuntimeContext({
        contextApiKey: 'ctx-key',
        contextBaseUrl: 'https://custom.example.com',
        adminApiKey: 'admin-key',
      }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://custom.example.com/v1/audio/transcriptions',
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
    const config = resolveConfig(runtimeContext)
    assert(config.ok, 'expected resolveConfig to return ok: true')
    expect(config.model).toBe('ctx-model')
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

  // ── fix 2: not_configured before rate-limit (tool path) ─────────────────

  test('tool returns not_configured when rate-limited AND api_key is missing (config checked first)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { facade, readMock } = createMockAttachments()
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ rateAllowed: false, retryAfterSec: 30, adminApiKey: undefined, attachments: facade }),
      createMockOptions(),
    )

    // Must return not_configured, NOT rate_limited — config check must precede rate-limit check
    expect(result).toMatchObject({ error: 'not_configured' })
    expect(readMock).not.toHaveBeenCalled()
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  // ── fix 2: not_configured before rate-limit (transformer path) ───────────

  test('transformer returns not configured when rate-limited AND api_key is missing (config checked first)', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({
      adminApiKey: undefined,
      rateAllowed: false,
      retryAfterSec: 30,
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    // Must report not configured, NOT rate limited — config check must precede rate-limit check
    assertTransformFailed(result)
    expect(result.reason).toContain('not configured')
    expect(result.reason).not.toContain('rate limited')
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

  // ── context override pairing ──────────────────────────────────────────────

  test('full context pair (api_key + base_url) → uses context key AND context base_url', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'ctx result', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        contextApiKey: 'ctx-key',
        contextBaseUrl: 'https://custom.example.com',
        adminApiKey: 'admin-key',
        adminBaseUrl: 'https://api.openai.com',
      }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://custom.example.com/v1/audio/transcriptions',
      expect.objectContaining({ headers: { Authorization: 'Bearer ctx-key' } }),
    )
  })

  test('context base_url WITHOUT api_key → incomplete_context_override (tool)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        contextBaseUrl: 'https://custom.example.com',
        adminApiKey: 'admin-key',
      }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'incomplete_context_override' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('context api_key WITHOUT base_url → incomplete_context_override (tool)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        contextApiKey: 'ctx-key',
        adminApiKey: 'admin-key',
      }),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'incomplete_context_override' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('context base_url WITHOUT api_key → transformer returns incomplete context override reason', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({
      contextBaseUrl: 'https://custom.example.com',
      adminApiKey: 'admin-key',
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    assertTransformFailed(result)
    expect(result.reason).toContain('incomplete context override')
    expect(result.reason).toContain('set both api_key and base_url')
  })

  test('model-only context override still works (no pairing required)', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const runtimeContext = createMockRuntimeContext({
      contextModel: 'custom-model',
      adminApiKey: 'admin-key',
    })
    const config = resolveConfig(runtimeContext)
    assert(config.ok, 'expected resolveConfig to return ok: true')
    expect(config.model).toBe('custom-model')

    const result = await registeredTool.value!.execute({ attachment_id: 'att_1' }, runtimeContext, createMockOptions())

    expect(result).toMatchObject({ text: 'hello' })
  })

  test('neither context key nor base_url → admin pair is used', async () => {
    const mockHttpFetch = mock().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hello', language: 'en', duration: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({ adminApiKey: 'admin-key', adminBaseUrl: 'https://api.openai.com' }),
      createMockOptions(),
    )

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ headers: { Authorization: 'Bearer admin-key' } }),
    )
  })

  test('describeApiFailure maps incomplete_context_override to correct message', () => {
    expect(describeApiFailure({ error: 'incomplete_context_override' })).toBe(
      'incomplete context override — set both api_key and base_url in this context, or clear both',
    )
  })
})

describe('normalizeModel input validation', () => {
  test('valid model name passes through unchanged', () => {
    expect(normalizeModel('whisper-1')).toBe('whisper-1')
    expect(normalizeModel('openai/whisper-1')).toBe('openai/whisper-1')
    expect(normalizeModel('whisper-large-v3-turbo')).toBe('whisper-large-v3-turbo')
    expect(normalizeModel('model.v2:latest')).toBe('model.v2:latest')
  })

  test('model name with injection characters falls back to DEFAULT_MODEL', () => {
    expect(normalizeModel('<script>alert(1)</script>')).toBe(DEFAULT_MODEL)
    expect(normalizeModel('model\ninjection')).toBe(DEFAULT_MODEL)
    expect(normalizeModel('model name with spaces')).toBe(DEFAULT_MODEL)
    expect(normalizeModel('../../../etc/passwd')).toBe(DEFAULT_MODEL)
  })

  test('model name exceeding 128 chars falls back to DEFAULT_MODEL', () => {
    const longName = 'a'.repeat(129)
    expect(normalizeModel(longName)).toBe(DEFAULT_MODEL)
    const exactLimit = 'a'.repeat(128)
    expect(normalizeModel(exactLimit)).toBe(exactLimit)
  })
})

describe('normalizeLanguage input validation', () => {
  test('valid 2-letter code passes through unchanged', () => {
    expect(normalizeLanguage('en')).toBe('en')
    expect(normalizeLanguage('ru')).toBe('ru')
    expect(normalizeLanguage('zh')).toBe('zh')
  })

  test('valid longer code passes through unchanged', () => {
    expect(normalizeLanguage('yue')).toBe('yue')
    expect(normalizeLanguage('ENGLISH')).toBe('ENGLISH')
    expect(normalizeLanguage('abcdefgh')).toBe('abcdefgh')
  })

  test('undefined returns undefined', () => {
    expect(normalizeLanguage(undefined)).toBeUndefined()
  })

  test('trailing whitespace is trimmed before validation', () => {
    // 'ru ' trims to 'ru' → valid
    expect(normalizeLanguage('ru ')).toBe('ru')
  })

  test('embedded control char makes language invalid → returns undefined', () => {
    expect(normalizeLanguage('e\r\nn')).toBeUndefined()
  })

  test('null bytes and other non-alpha chars → returns undefined', () => {
    expect(normalizeLanguage('e\0n')).toBeUndefined()
    expect(normalizeLanguage('en-US')).toBeUndefined()
    expect(normalizeLanguage('123')).toBeUndefined()
  })

  test('too-short (1 char) or too-long (9+ chars) → returns undefined', () => {
    expect(normalizeLanguage('a')).toBeUndefined()
    expect(normalizeLanguage('abcdefghi')).toBeUndefined()
  })
})

describe('normalizeLanguage applied in buildMultipartBody', () => {
  test('valid language is included in FormData', async () => {
    const capturedInits: (RequestInit | undefined)[] = []
    const mockHttpFetch = mock((_url: string, init?: RequestInit) => {
      capturedInits.push(init)
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'bonjour', language: 'fr', duration: 1.0 }), {
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
      createMockRuntimeContext(),
      createMockOptions(),
    )

    const body = capturedInits.at(0)?.body
    assert(body instanceof FormData, 'expected request body to be FormData')
    expect(body.get('language')).toBe('fr')
  })

  test('language with embedded control char is dropped from FormData', async () => {
    const capturedInits: (RequestInit | undefined)[] = []
    const mockHttpFetch = mock((_url: string, init?: RequestInit) => {
      capturedInits.push(init)
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'bonjour', language: 'fr', duration: 1.0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1', language: 'e\r\nn' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    const body = capturedInits.at(0)?.body
    assert(body instanceof FormData, 'expected request body to be FormData')
    // Invalid language must be dropped — field absent, not forwarded to the API
    expect(body.get('language')).toBeNull()
  })

  test('language with trailing whitespace is normalized and present in FormData', async () => {
    const capturedInits: (RequestInit | undefined)[] = []
    const mockHttpFetch = mock((_url: string, init?: RequestInit) => {
      capturedInits.push(init)
      return Promise.resolve(
        new Response(JSON.stringify({ text: 'hi', language: 'ru', duration: 1.0 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    })
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    await registeredTool.value!.execute(
      { attachment_id: 'att_1', language: 'ru ' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    const body = capturedInits.at(0)?.body
    assert(body instanceof FormData, 'expected request body to be FormData')
    // Trailing space trimmed → 'ru' passes validation → present in FormData
    expect(body.get('language')).toBe('ru')
  })
})

describe('XOR guard: whitespace-only base_url edge cases', () => {
  test('whitespace-only context base_url + real context api_key → treated as unset → incomplete_context_override', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        contextBaseUrl: '   ',
        contextApiKey: 'ctx-key',
        adminApiKey: 'admin-key',
      }),
      createMockOptions(),
    )

    // whitespace-only base_url → normalized to undefined; api_key is set → XOR mismatch → incomplete_context_override
    expect(result).toMatchObject({ error: 'incomplete_context_override' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
  })

  test('context api_key WITHOUT base_url → transformer returns incomplete context override reason', async () => {
    const mockHttpFetch = mock()
    const { ctx, registeredTransformer } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const record = makeVoiceRecord()
    const runtimeContext = createMockRuntimeContext({
      contextApiKey: 'ctx-key',
      adminApiKey: 'admin-key',
    })

    const result: AttachmentTransformResult = await registeredTransformer.value!.transform(record, runtimeContext)

    assertTransformFailed(result)
    expect(result.reason).toContain('incomplete context override')
    expect(result.reason).toContain('set both api_key and base_url')
  })
})
