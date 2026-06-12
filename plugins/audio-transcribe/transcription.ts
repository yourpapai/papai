// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { PluginAttachmentRecord, PluginToolRuntimeContext } from '../../src/plugins/types.js'

export const DEFAULT_BASE_URL = 'https://api.openai.com'
export const DEFAULT_MODEL = 'whisper-1'
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024
export const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export const AUDIO_EXTENSIONS = ['.ogg', '.opus', '.mp3', '.m4a', '.wav', '.webm'] as const

export type HttpFetch = (url: string, init?: RequestInit) => Promise<Response>

export type TranscribeResult = {
  text: string
  language?: string
  durationSec?: number
}

export type ResolvedConfig =
  | { ok: true; apiKey: string | undefined; baseUrl: string; model: string }
  | { ok: false; error: 'incomplete_context_override' }

export const apiResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  duration: z.number().optional(),
})

export const cachedSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  durationSec: z.number().optional(),
  cachedAt: z.string().optional(),
})

export function normalizeBaseUrl(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  const base = value === '' ? DEFAULT_BASE_URL : value
  return base.endsWith('/') ? base.slice(0, -1) : base
}

export function normalizeModel(raw: string | undefined): string {
  const value = (raw ?? '').trim()
  if (value === '') return DEFAULT_MODEL
  // Restrict to safe characters to prevent model-name injection into API calls.
  // Must start with alphanumeric; allows . _ : / - for paths like openai/whisper-1.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/u.test(value)) return DEFAULT_MODEL
  return value
}

export function resolveConfig(runtimeContext: PluginToolRuntimeContext): ResolvedConfig {
  const contextKey = runtimeContext.contextConfig.get('api_key')
  const contextBase = runtimeContext.contextConfig.get('base_url')
  // Treat empty strings as unset
  const normalizedContextKey = contextKey !== undefined && contextKey.trim() !== '' ? contextKey : undefined
  const normalizedContextBase = contextBase !== undefined && contextBase.trim() !== '' ? contextBase : undefined
  const model = normalizeModel(runtimeContext.contextConfig.get('model') ?? runtimeContext.adminConfig.get('model'))
  // Both must be set together or both must be absent
  if ((normalizedContextKey === undefined) !== (normalizedContextBase === undefined)) {
    return { ok: false, error: 'incomplete_context_override' }
  }
  if (normalizedContextKey !== undefined && normalizedContextBase !== undefined) {
    return { ok: true, apiKey: normalizedContextKey, baseUrl: normalizeBaseUrl(normalizedContextBase), model }
  }
  return {
    ok: true,
    apiKey: runtimeContext.adminConfig.get('api_key'),
    baseUrl: normalizeBaseUrl(runtimeContext.adminConfig.get('base_url')),
    model,
  }
}

export function isAudioRecord(record: Pick<PluginAttachmentRecord, 'mimeType' | 'filename'>): boolean {
  if (record.mimeType !== undefined) return record.mimeType.startsWith('audio/')
  const lower = record.filename.toLowerCase()
  return AUDIO_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export function readCachedTranscript(
  kv: PluginToolRuntimeContext['kv'],
  cacheKey: string,
): TranscribeResult | undefined {
  const raw = kv.get(cacheKey)
  if (raw === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    const validated = cachedSchema.safeParse(parsed)
    if (validated.success) {
      const { text, language, durationSec } = validated.data
      const result: TranscribeResult = { text }
      if (language !== undefined) result.language = language
      if (durationSec !== undefined) result.durationSec = durationSec
      return result
    }
  } catch {
    // fall through
  }
  kv.delete(cacheKey)
  return undefined
}

function pruneOldCacheEntries(kv: PluginToolRuntimeContext['kv'], justWrittenKey: string): void {
  const entries = kv.list('transcript:')
  const now = Date.now()
  for (const entry of entries) {
    if (entry.key === justWrittenKey) continue
    try {
      const parsed: unknown = JSON.parse(entry.value)
      const validated = cachedSchema.safeParse(parsed)
      if (!validated.success) {
        kv.delete(entry.key)
        continue
      }
      const { cachedAt } = validated.data
      if (cachedAt === undefined) {
        kv.delete(entry.key)
        continue
      }
      const age = now - new Date(cachedAt).getTime()
      if (isNaN(age) || age > CACHE_MAX_AGE_MS) {
        kv.delete(entry.key)
      }
    } catch {
      kv.delete(entry.key)
    }
  }
}

export function writeCache(kv: PluginToolRuntimeContext['kv'], cacheKey: string, result: TranscribeResult): void {
  try {
    kv.set(cacheKey, JSON.stringify({ ...result, cachedAt: new Date().toISOString() }))
    pruneOldCacheEntries(kv, cacheKey)
  } catch {
    // KV may be denied; ignore cache write failure.
  }
}

export async function loadAudioAttachment(
  runtimeContext: PluginToolRuntimeContext,
  attachmentId: string,
): Promise<{ ok: true; record: PluginAttachmentRecord; bytes: Buffer } | { ok: false; result: unknown }> {
  try {
    const { record, bytes } = await runtimeContext.attachments.read(attachmentId)
    if (!isAudioRecord(record)) {
      return {
        ok: false,
        result: { error: 'unsupported_media_type', mimeType: record.mimeType ?? null },
      }
    }
    // The facade returns record+bytes atomically, so the blob is already in memory
    // when this guard fires — it prevents the API call, not the allocation; a
    // pre-fetch metadata check would need a facade change.
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

export function buildMultipartBody(
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

export async function callTranscriptionApi(
  httpFetch: HttpFetch,
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

export function transcribeRecord(
  record: PluginAttachmentRecord,
  bytes: Buffer,
  language: string | undefined,
  config: Extract<ResolvedConfig, { ok: true }>,
  httpFetch: HttpFetch,
): Promise<TranscribeResult | { error: string; status?: number; message?: string }> {
  const { apiKey, baseUrl, model } = config
  if (apiKey === undefined || apiKey.trim() === '') {
    return Promise.resolve({
      error: 'not_configured',
      message: 'audio-transcribe: api_key missing',
    })
  }
  const body = buildMultipartBody(record, bytes, model, language)
  return callTranscriptionApi(httpFetch, baseUrl, apiKey, body)
}

export const describeLoadFailure = (result: unknown): string => {
  const error =
    typeof result === 'object' && result !== null && 'error' in result
      ? String((result as { error: unknown }).error)
      : 'unknown'
  if (error === 'audio_too_large') return `file too large (max ${Math.floor(MAX_AUDIO_BYTES / (1024 * 1024))} MiB)`
  if (error === 'attachment_not_found') return 'attachment not found'
  if (error === 'unsupported_media_type') return 'unsupported media type'
  return 'transcription service error'
}

export const describeApiFailure = (result: { error: string }): string => {
  if (result.error === 'not_configured')
    return 'not configured — the admin can set a transcription API key in the settings UI'
  if (result.error === 'incomplete_context_override')
    return 'incomplete context override — set both api_key and base_url in this context, or clear both'
  if (result.error === 'timeout') return 'transcription timed out — try again'
  return 'transcription service error'
}
