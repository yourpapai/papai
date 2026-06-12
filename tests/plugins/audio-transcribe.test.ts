// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ToolExecutionOptions } from 'ai'

import factory from '../../plugins/audio-transcribe/index.js'
import type { PluginContext, PluginLogger, PluginRegistration } from '../../src/plugins/context.js'
import type {
  PluginAttachmentFacade,
  PluginPromptFragment,
  PluginTool,
  PluginToolRuntimeContext,
} from '../../src/plugins/types.js'

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
  } = {},
): {
  ctx: PluginContext
  registeredTool: { value: PluginTool | undefined }
  registeredFragment: { value: PluginPromptFragment | undefined }
} {
  const registeredTool: { value: PluginTool | undefined } = { value: undefined }
  const registeredFragment: { value: PluginPromptFragment | undefined } = { value: undefined }

  const registration: PluginRegistration = {
    registerTool: (tool: PluginTool) => {
      registeredTool.value = tool
    },
    registerPromptFragment: (fragment: PluginPromptFragment) => {
      registeredFragment.value = fragment
    },
    registerCommand: () => {},
    registerScheduledJob: () => {},
    registerAttachmentTransformer: () => {},
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
    providerRuntime: {
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

  return { ctx, registeredTool, registeredFragment }
}

type MockAttachments = { facade: PluginAttachmentFacade; readMock: ReturnType<typeof mock> }

function createMockAttachments(
  overrides: {
    filename?: string
    mimeType?: string | undefined
    size?: number
    bytes?: Buffer
    throwOnRead?: Error
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
      list: () => Array.from(kvBacking.entries()).map(([key, value]) => ({ key, value })),
    },
    rateLimit: {
      check: () => ({
        allowed: overrides.rateAllowed ?? true,
        retryAfterSec: overrides.retryAfterSec,
      }),
    },
    adminConfig: {
      get: () => undefined,
    },
    attachments: overrides.attachments ?? createMockAttachments().facade,
  }
}

function createMockOptions(): ToolExecutionOptions {
  return { toolCallId: 'test-call-id', messages: [] }
}

describe('audio-transcribe plugin', () => {
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

  test('rejects non-audio mime types', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({ httpFetch: mockHttpFetch })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext({
        attachments: createMockAttachments({ mimeType: 'image/png', filename: 'pic.png' }).facade,
      }),
      createMockOptions(),
    )

    expect(result).toEqual({ error: 'unsupported_media_type', mimeType: 'image/png' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
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

    await registeredTool.value!.execute({ attachment_id: 'att_1' }, createMockRuntimeContext(), createMockOptions())

    expect(mockHttpFetch).toHaveBeenCalledWith(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  test('returns not_configured when api_key is missing', async () => {
    const mockHttpFetch = mock().mockResolvedValue(new Response('', { status: 200 }))
    const { ctx, registeredTool } = createMockContext({
      httpFetch: mockHttpFetch,
      config: { apiKey: undefined },
    })
    const instance = factory()
    void instance.activate(ctx)

    const result = await registeredTool.value!.execute(
      { attachment_id: 'att_1' },
      createMockRuntimeContext(),
      createMockOptions(),
    )

    expect(result).toMatchObject({ error: 'not_configured' })
    expect(mockHttpFetch).not.toHaveBeenCalled()
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
})
