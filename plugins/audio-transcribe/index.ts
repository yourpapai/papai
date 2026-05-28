// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginContext } from '../../src/plugins/context.js'
import type { PluginAttachmentRecord, PluginFactory, PluginToolRuntimeContext } from '../../src/plugins/types.js'

const DEFAULT_BASE_URL = 'https://api.openai.com'
const DEFAULT_MODEL = 'whisper-1'
const MAX_AUDIO_BYTES = 24 * 1024 * 1024

const transcribeInputSchema = z.object({
  attachment_id: z.string().min(1).max(200),
  language: z.string().min(2).max(8).optional(),
})

const apiResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
})

const cachedSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationSec: z.number().optional(),
})

type TranscribeResult = z.infer<typeof cachedSchema>

function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  const base = value === '' ? DEFAULT_BASE_URL : value
  return base.endsWith('/') ? base.slice(0, -1) : base
}

function normalizeModel(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  return value === '' ? DEFAULT_MODEL : value
}

function readCachedTranscript(kv: PluginToolRuntimeContext['kv'], cacheKey: string): TranscribeResult | undefined {
  const raw = kv.get(cacheKey)
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    const validated = cachedSchema.safeParse(parsed)
    if (validated.success) return validated.data
  } catch {
    // fall through
  }
  kv.delete(cacheKey)
  return undefined
}

async function loadAudioAttachment(
  runtimeContext: PluginToolRuntimeContext,
  attachmentId: string,
): Promise<{ ok: true; record: PluginAttachmentRecord; bytes: Buffer } | { ok: false; result: unknown }> {
  try {
    const { record, bytes } = await runtimeContext.attachments.read(attachmentId)
    if (record.mimeType === undefined || !record.mimeType.startsWith('audio/')) {
      return {
        ok: false,
        result: { error: 'unsupported_media_type', mimeType: record.mimeType ?? null },
      }
    }
    const size = record.size ?? bytes.byteLength
    if (size > MAX_AUDIO_BYTES) {
      return {
        ok: false,
        result: { error: 'audio_too_large', sizeBytes: size, maxBytes: MAX_AUDIO_BYTES },
      }
    }
    return { ok: true, record, bytes }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('attachment_not_found')) {
      return { ok: false, result: { error: 'attachment_not_found' } }
    }
    return { ok: false, result: { error: 'network_error', message } }
  }
}

function buildMultipartBody(
  record: PluginAttachmentRecord,
  bytes: Buffer,
  model: string,
  language: string | undefined,
): FormData {
  const form = new FormData()
  form.append('model', model)
  form.append('response_format', 'json')
  if (language !== undefined) form.append('language', language)
  // Copy to a fresh ArrayBuffer. Buffer's underlying `.buffer` is typed as
  // ArrayBuffer | SharedArrayBuffer since TS 5.7, which BlobPart rejects.
  const arrayBuffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(arrayBuffer).set(bytes)
  form.append('file', new Blob([arrayBuffer], { type: record.mimeType ?? 'application/octet-stream' }), record.filename)
  return form
}

async function callTranscriptionApi(
  httpFetch: (url: string, init?: RequestInit) => Promise<Response>,
  baseUrl: string,
  apiKey: string,
  body: FormData,
): Promise<TranscribeResult | { error: string; status?: number; message?: string }> {
  try {
    const response = await httpFetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      return { error: 'api_error', status: response.status, message: errorText.slice(0, 500) }
    }

    const data: unknown = await response.json().catch(() => null)
    const validated = apiResponseSchema.safeParse(data)
    if (!validated.success) {
      return { error: 'bad_response', message: validated.error.message.slice(0, 500) }
    }

    const result: TranscribeResult = { text: validated.data.text }
    if (validated.data.language !== undefined) result.language = validated.data.language
    if (validated.data.duration !== undefined) result.durationSec = validated.data.duration
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'timeout', message }
    }
    return { error: 'network_error', message }
  }
}

async function executeTranscribe(
  input: unknown,
  runtimeContext: PluginToolRuntimeContext,
  apiKey: string | undefined,
  baseUrl: string,
  model: string,
  httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined,
): Promise<unknown> {
  const rateResult = runtimeContext.rateLimit.check(runtimeContext.storageContextId)
  if (!rateResult.allowed) {
    return { error: 'rate_limited', retryAfterSec: rateResult.retryAfterSec }
  }

  let parsed: z.infer<typeof transcribeInputSchema>
  try {
    parsed = transcribeInputSchema.parse(input)
  } catch (err) {
    if (err instanceof z.ZodError) {
      return { error: 'validation_error', message: err.message }
    }
    throw err
  }

  const cacheKey = `transcript:${parsed.attachment_id}`
  const cached = readCachedTranscript(runtimeContext.kv, cacheKey)
  if (cached !== undefined) return cached

  if (apiKey === undefined || apiKey.trim() === '' || httpFetch === undefined) {
    return {
      error: 'not_configured',
      message: 'audio-transcribe: api_key missing or providerRuntime unavailable',
    }
  }

  const audio = await loadAudioAttachment(runtimeContext, parsed.attachment_id)
  if (!audio.ok) return audio.result

  const body = buildMultipartBody(audio.record, audio.bytes, model, parsed.language)
  const apiResult = await callTranscriptionApi(httpFetch, baseUrl, apiKey, body)
  if ('error' in apiResult) return apiResult

  try {
    runtimeContext.kv.set(cacheKey, JSON.stringify(apiResult))
  } catch {
    // KV may be denied (no storage permission); ignore cache write failure.
  }
  return apiResult
}

const factory: PluginFactory = () => {
  let apiKey: string | undefined
  let baseUrl = DEFAULT_BASE_URL
  let model = DEFAULT_MODEL
  let httpFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined

  return {
    activate(ctx: PluginContext): void {
      apiKey = ctx.adminConfig.get('api_key')
      baseUrl = normalizeBaseUrl(ctx.adminConfig.get('base_url'))
      model = normalizeModel(ctx.adminConfig.get('model'))
      httpFetch = ctx.providerRuntime?.httpFetch

      ctx.log.info({ baseUrl, model }, 'audio-transcribe plugin activated')

      ctx.registration.registerTool({
        name: 'transcribe',
        description: 'Transcribes an audio attachment to text. Call this when the user sends a voice/audio message.',
        inputSchema: transcribeInputSchema,
        execute: (input: unknown, runtimeContext: PluginToolRuntimeContext) =>
          executeTranscribe(input, runtimeContext, apiKey, baseUrl, model, httpFetch),
      })

      ctx.registration.registerPromptFragment({
        name: 'audio-transcribe-hint',
        content:
          'When you see a message history line like `[User attached att_<id>: <filename>]` and the filename ends in .ogg/.opus/.mp3/.m4a/.wav/.webm (or is `voice.ogg`), you MUST first call the transcribe tool with that attachment id. Treat the returned text as if the user had typed it. Do not respond to the user before transcribing.',
      })
    },

    deactivate(ctx: PluginContext): void {
      ctx.log.info({}, 'audio-transcribe plugin deactivated')
    },
  }
}

export default factory
